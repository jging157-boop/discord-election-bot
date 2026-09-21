const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.log("❌ DISCORD_TOKEN 또는 CLIENT_ID가 없습니다.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const DATA_FILE = path.join(__dirname, "stock-data.json");

/* =========================
   기본 설정
========================= */

const TAX_RATE = 20;

// 소형주식
const SMALL_MAX = 20;
const SMALL_MIN = 500000;

// 대형주식
const LARGE_MAX = 50;
const LARGE_MIN = 1000000;

const defaultData = {
  stocks: {
    "WB그룹": {
      price: 1000,
      type: "small"
    },
    "유마그룹": {
      price: 1000,
      type: "small"
    }
  },

  users: {},

  guilds: {}
};

/* =========================
   데이터
========================= */

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaultData, null, 2)
      );

      return structuredClone(defaultData);
    }

    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    data.stocks ??= {};
    data.users ??= {};
    data.guilds ??= {};

    for (const stock of Object.values(data.stocks)) {
      stock.type ??= "small";
    }

    return data;
  } catch (err) {
    console.error(err);
    return structuredClone(defaultData);
  }
}

let data = loadData();

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

/* =========================
   돈
========================= */

function big(value) {
  const text = String(value)
    .replace(/,/g, "")
    .trim();

  if (!/^\d+$/.test(text)) {
    throw new Error("INVALID_MONEY");
  }

  return BigInt(text);
}

function money(value) {
  return big(value).toLocaleString("ko-KR");
}

function cash(account) {
  return big(account.cash || 0);
}

function taxCash(account) {
  return big(account.taxFreeCash || 0);
}

function setCash(account, value) {
  account.cash = big(value).toString();
}

function setTaxCash(account, value) {
  account.taxFreeCash = big(value).toString();
}

/* =========================
   계정
========================= */

function getGuild(guildId) {
  data.guilds[guildId] ??= {
    startingCash: 10000,
    adminRoleId: null,
    logChannelId: null,
    logRoleId: null,
    stockMenuChannelId: null,
    stockMenuMessageId: null
  };

  return data.guilds[guildId];
}

function getAccount(userId, guildId) {
  if (!data.users[userId]) {
    const settings = getGuild(guildId);

    data.users[userId] = {
      cash: String(settings.startingCash),
      taxFreeCash: "0",
      holdings: {},
      taxFreeHoldings: {}
    };
  }

  const account = data.users[userId];

  account.cash ??= "0";
  account.taxFreeCash ??= "0";
  account.holdings ??= {};
  account.taxFreeHoldings ??= {};

  return account;
}

/* =========================
   권한
========================= */

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(
    PermissionFlagsBits.Administrator
  );
}

function isStockAdmin(interaction) {
  if (isAdmin(interaction)) return true;

  const settings = getGuild(interaction.guildId);

  return (
    settings.adminRoleId &&
    interaction.member?.roles?.cache?.has(
      settings.adminRoleId
    )
  );
}

/* =========================
   로그
========================= */

async function log(interaction, title, description) {
  const settings = getGuild(interaction.guildId);

  if (!settings.logChannelId) return;

  const channel =
    interaction.guild.channels.cache.get(
      settings.logChannelId
    );

  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  await channel
    .send({ embeds: [embed] })
    .catch(() => {});
}

/* =========================
   선거
========================= */

const elections = new Map();

/* =========================
   명령어
========================= */

const commands = [

  new SlashCommandBuilder()
    .setName("선거시작")
    .setDescription("선거를 시작합니다."),

  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("후보를 등록합니다.")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("후보 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("투표")
    .setDescription("투표합니다.")
    .addStringOption(o =>
      o.setName("후보")
        .setDescription("후보 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("선거종료")
    .setDescription("선거를 종료합니다."),

  new SlashCommandBuilder()
    .setName("결과")
    .setDescription("선거 결과를 확인합니다."),

  new SlashCommandBuilder()
    .setName("주식참여")
    .setDescription("주식 게임에 참여합니다."),

  new SlashCommandBuilder()
    .setName("주식목록")
    .setDescription("주식 목록을 봅니다."),

  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("일반돈으로 주식을 매수합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("종목")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("매도")
    .setDescription("일반 주식을 매도합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("종목")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세매수")
    .setDescription("면세돈으로 주식을 매수합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("종목")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세매도")
    .setDescription("면세 주식을 매도합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("종목")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("잔액")
    .setDescription("내 돈을 확인합니다."),

  new SlashCommandBuilder()
    .setName("내주식")
    .setDescription("내 주식을 확인합니다."),

  new SlashCommandBuilder()
    .setName("주식랭킹")
    .setDescription("주식 자산 랭킹을 봅니다."),

  new SlashCommandBuilder()
    .setName("주식메뉴")
    .setDescription("주식 버튼 메뉴를 만듭니다."),

  new SlashCommandBuilder()
    .setName("돈추가")
    .setDescription("일반돈을 추가합니다.")
    .addUserOption(o =>
      o.setName("대상")
        .setDescription("대상")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("돈제거")
    .setDescription("일반돈을 제거합니다.")
    .addUserOption(o =>
      o.setName("대상")
        .setDescription("대상")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세돈추가")
    .setDescription("면세돈을 추가합니다.")
    .addUserOption(o =>
      o.setName("대상")
        .setDescription("대상")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세돈제거")
    .setDescription("면세돈을 제거합니다.")
    .addUserOption(o =>
      o.setName("대상")
        .setDescription("대상")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식추가")
    .setDescription("주식을 추가합니다.")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("주식 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("가격")
        .setDescription("시작 가격")
        .setMinValue(1)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("종류")
        .setDescription("small 또는 large")
        .addChoices(
          { name: "소형주식", value: "small" },
          { name: "대형주식", value: "large" }
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식삭제")
    .setDescription("주식을 삭제합니다.")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("주식 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식가격")
    .setDescription("주식 가격을 변경합니다.")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("주식 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("가격")
        .setDescription("가격")
        .setMinValue(1)
        .setRequired(true)
    )

].map(x => x.toJSON());

/* =========================
   봇 시작
========================= */

client.once("ready", async () => {

  console.log(`✅ ${client.user.tag} 로그인 완료`);

  const rest = new REST({ version: "10" })
    .setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("✅ 명령어 등록 완료");
});

/* =========================
   주식 계산
========================= */

function getTax(price) {
  return (price * 20n) / 100n;
}

function getStockLimit(stock) {
  return stock.type === "large"
    ? LARGE_MAX
    : SMALL_MAX;
}

function getMinimum(stock) {
  return stock.type === "large"
    ? LARGE_MIN
    : SMALL_MIN;
}

/* =========================
   주식 매수
========================= */

async function buyStock(
  interaction,
  name,
  amount,
  taxFree
) {

  const account = getAccount(
    interaction.user.id,
    interaction.guildId
  );

  const stock = data.stocks[name];

  if (!stock) {
    return interaction.reply("❌ 존재하지 않는 주식입니다.");
  }

  const limit = getStockLimit(stock);

  if (amount > limit) {
    return interaction.reply(
      `❌ ${stock.type === "large" ? "대형" : "소형"}주식은 한 번에 최대 **${limit}주**까지 구매할 수 있습니다.`
    );
  }

  const price = BigInt(stock.price);
  const subtotal = price * BigInt(amount);

  const minimum = BigInt(getMinimum(stock));

  if (subtotal < minimum) {
    return interaction.reply(
      `❌ 최소 구매금액은 **${money(minimum)}원**입니다.`
    );
  }

  if (taxFree) {

    const balance = taxCash(account);

    if (balance < subtotal) {
      return interaction.reply(
        `❌ 면세돈이 부족합니다.\n` +
        `필요: **${money(subtotal)}원**\n` +
        `보유: **${money(balance)}원**`
      );
    }

    // 면세돈 자동 차감
    setTaxCash(
      account,
      balance - subtotal
    );

    account.taxFreeHoldings[name] =
      (account.taxFreeHoldings[name] || 0) + amount;

    saveData();

    await log(
      interaction,
      "🛡️ 면세 주식 매수",
      `${interaction.user} 님이 ${name} ${amount}주를 면세돈으로 매수했습니다.\n` +
      `사용 면세돈: ${money(subtotal)}원`
    );

    return interaction.reply(
      `🛡️ **${name} ${amount}주 매수 완료**\n` +
      `💸 면세돈 ${money(subtotal)}원 차감\n` +
      `🧾 세금: 0원`
    );
  }

  // 일반돈 거래
  const tax = getTax(subtotal);
  const total = subtotal + tax;

  const balance = cash(account);

  if (balance < total) {
    return interaction.reply(
      `❌ 일반돈이 부족합니다.\n` +
      `주식가격: **${money(subtotal)}원**\n` +
      `세금 20%: **${money(tax)}원**\n` +
      `총 필요: **${money(total)}원**`
    );
  }

  setCash(
    account,
    balance - total
  );

  account.holdings[name] =
    (account.holdings[name] || 0) + amount;

  saveData();

  await log(
    interaction,
    "🟢 일반 주식 매수",
    `${interaction.user} 님이 ${name} ${amount}주를 매수했습니다.\n` +
    `주식가격: ${money(subtotal)}원\n` +
    `세금: ${money(tax)}원`
  );

  return interaction.reply(
    `✅ **${name} ${amount}주 매수 완료**\n` +
    `💸 주식가격: ${money(subtotal)}원\n` +
    `🧾 세금 20%: ${money(tax)}원\n` +
    `💰 총 사용: **${money(total)}원**`
  );
}

/* =========================
   주식 매도
========================= */

async function sellStock(
  interaction,
  name,
  amount,
  taxFree
) {

  const account = getAccount(
    interaction.user.id,
    interaction.guildId
  );

  const stock = data.stocks[name];

  if (!stock) {
    return interaction.reply("❌ 존재하지 않는 주식입니다.");
  }

  const holdings = taxFree
    ? account.taxFreeHoldings
    : account.holdings;

  const owned = holdings[name] || 0;

  if (owned < amount) {
    return interaction.reply(
      `❌ 보유 주식이 부족합니다.\n보유량: **${owned}주**`
    );
  }

  const subtotal =
    BigInt(stock.price) * BigInt(amount);

  holdings[name] -= amount;

  if (holdings[name] <= 0) {
    delete holdings[name];
  }

  if (taxFree) {

    // 면세주식 매도금은 면세돈으로 돌아감
    setTaxCash(
      account,
      taxCash(account) + subtotal
    );

    saveData();

    return interaction.reply(
      `🛡️ **${name} ${amount}주 매도 완료**\n` +
      `💰 면세돈 +${money(subtotal)}원\n` +
      `🧾 세금: 0원`
    );
  }

  const tax = getTax(subtotal);
  const receive = subtotal - tax;

  setCash(
    account,
    cash(account) + receive
  );

  saveData();

  return interaction.reply(
    `✅ **${name} ${amount}주 매도 완료**\n` +
    `💵 판매금액: ${money(subtotal)}원\n` +
    `🧾 세금 20%: ${money(tax)}원\n` +
    `💰 받은 돈: **${money(receive)}원**`
  );
}

/* =========================
   버튼 메뉴
========================= */

function stockMenu() {

  const row = new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId("buy_normal")
        .setLabel("💰 일반돈으로 매수")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("buy_taxfree")
        .setLabel("🛡️ 면세돈으로 매수")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("sell_stock")
        .setLabel("📉 매도")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("wallet")
        .setLabel("👛 내 지갑")
        .setStyle(ButtonStyle.Secondary)
    );

  return row;
}

function stockMenuText() {

  let text =
    "📈 **주식 거래소**\n\n";

  for (const [name, stock] of Object.entries(data.stocks)) {

    text +=
      `${stock.type === "large" ? "🔵 대형" : "🟢 소형"} ` +
      `**${name}** — ${money(stock.price)}원\n`;
  }

  text +=
    `\n🧾 일반 거래 세금: **20%**` +
    `\n🛡️ 면세 거래: **세금 0%**` +
    `\n\n버튼을 눌러 거래하세요.`;

  return text;
}

/* =========================
   버튼 처리
========================= */

client.on("interactionCreate", async interaction => {

  if (interaction.isButton()) {

    if (interaction.customId === "wallet") {

      const account =
        getAccount(
          interaction.user.id,
          interaction.guildId
        );

      return interaction.reply({
        content:
          `👛 **내 지갑**\n\n` +
          `💰 일반돈: **${money(cash(account))}원**\n` +
          `🛡️ 면세돈: **${money(taxCash(account))}원**`,
        ephemeral: true
      });
    }

    if (
      interaction.customId === "buy_normal" ||
      interaction.customId === "buy_taxfree" ||
      interaction.customId === "sell_stock"
    ) {

      const modal =
        new ModalBuilder()
          .setCustomId(
            interaction.customId === "buy_normal"
              ? "modal_buy_normal"
              : interaction.customId === "buy_taxfree"
              ? "modal_buy_taxfree"
              : "modal_sell"
          )
          .setTitle(
            interaction.customId === "sell_stock"
              ? "주식 매도"
              : "주식 매수"
          );

      const nameInput =
        new TextInputBuilder()
          .setCustomId("stock")
          .setLabel("종목 이름")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

      const amountInput =
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("수량")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder()
          .addComponents(nameInput),

        new ActionRowBuilder()
          .addComponents(amountInput)
      );

      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {

    const name =
      interaction.fields.getTextInputValue("stock").trim();

    const amountText =
      interaction.fields.getTextInputValue("amount").trim();

    const amount =
      Number(amountText);

    if (
      !Number.isInteger(amount) ||
      amount < 1
    ) {
      return interaction.reply("❌ 수량은 1 이상의 정수여야 합니다.");
    }

    if (interaction.customId === "modal_buy_normal") {
      return buyStock(
        interaction,
        name,
        amount,
        false
      );
    }

    if (interaction.customId === "modal_buy_taxfree") {
      return buyStock(
        interaction,
        name,
        amount,
        true
      );
    }

    if (interaction.customId === "modal_sell") {
      return sellStock(
        interaction,
        name,
        amount,
        false
      );
    }
  }
});

/* =========================
   명령어 처리
========================= */

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId) return;

  const command = interaction.commandName;

  /* ===== 선거 ===== */

  if (command === "선거시작") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    if (elections.get(interaction.guildId)?.active)
      return interaction.reply("❌ 이미 선거가 진행 중입니다.");

    elections.set(interaction.guildId, {
      active: true,
      candidates: new Map(),
      voters: new Set()
    });

    return interaction.reply(
      "🗳️ **선거가 시작되었습니다!**"
    );
  }

  if (command === "후보등록") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const election =
      elections.get(interaction.guildId);

    if (!election?.active)
      return interaction.reply("❌ 진행 중인 선거가 없습니다.");

    if (election.candidates.size >= 20)
      return interaction.reply("❌ 후보는 최대 20명입니다.");

    const name =
      interaction.options.getString("이름").trim();

    if (election.candidates.has(name))
      return interaction.reply("❌ 이미 등록된 후보입니다.");

    election.candidates.set(name, 0);

    return interaction.reply(
      `✅ **${name}** 후보 등록 완료`
    );
  }

  if (command === "투표") {

    const election =
      elections.get(interaction.guildId);

    if (!election?.active)
      return interaction.reply("❌ 진행 중인 선거가 없습니다.");

    if (election.voters.has(interaction.user.id))
      return interaction.reply("❌ 이미 투표했습니다.");

    const name =
      interaction.options.getString("후보").trim();

    if (!election.candidates.has(name))
      return interaction.reply("❌ 존재하지 않는 후보입니다.");

    election.candidates.set(
      name,
      election.candidates.get(name) + 1
    );

    election.voters.add(interaction.user.id);

    return interaction.reply(
      `✅ **${name}** 후보에게 투표했습니다.`
    );
  }

  if (command === "선거종료") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const election =
      elections.get(interaction.guildId);

    if (!election?.active)
      return interaction.reply("❌ 진행 중인 선거가 없습니다.");

    election.active = false;

    return interaction.reply(
      "🛑 **선거가 종료되었습니다.**"
    );
  }

  if (command === "결과") {

    const election =
      elections.get(interaction.guildId);

    if (!election)
      return interaction.reply("❌ 선거가 없습니다.");

    const result =
      [...election.candidates.entries()]
        .sort((a, b) => b[1] - a[1]);

    let text = "📊 **선거 결과**\n\n";

    result.forEach(([name, votes], i) => {
      text +=
        `${i + 1}. **${name}** — ${votes}표\n`;
    });

    text +=
      `\n총 투표자: ${election.voters.size}명`;

    return interaction.reply(text);
  }

  /* ===== 주식 참여 ===== */

  if (command === "주식참여") {

    if (data.users[interaction.user.id])
      return interaction.reply("❌ 이미 참여 중입니다.");

    const settings =
      getGuild(interaction.guildId);

    data.users[interaction.user.id] = {
      cash: String(settings.startingCash),
      taxFreeCash: "0",
      holdings: {},
      taxFreeHoldings: {}
    };

    saveData();

    return interaction.reply(
      `✅ 주식 게임 참여 완료!\n` +
      `💰 시작금: ${money(settings.startingCash)}원`
    );
  }

  /* ===== 목록 ===== */

  if (command === "주식목록") {

    let text = "📈 **주식 목록**\n\n";

    for (const [name, stock] of Object.entries(data.stocks)) {

      text +=
        `${stock.type === "large" ? "🔵 대형" : "🟢 소형"} ` +
        `**${name}** — ${money(stock.price)}원\n`;
    }

    return interaction.reply(text);
  }

  /* ===== 매수 ===== */

  if (command === "매수") {

    const name =
      interaction.options.getString("종목").trim();

    const amount =
      interaction.options.getInteger("수량");

    return buyStock(
      interaction,
      name,
      amount,
      false
    );
  }

  /* ===== 면세 매수 ===== */

  if (command === "면세매수") {

    const name =
      interaction.options.getString("종목").trim();

    const amount =
      interaction.options.getInteger("수량");

    return buyStock(
      interaction,
      name,
      amount,
      true
    );
  }

  /* ===== 매도 ===== */

  if (command === "매도") {

    const name =
      interaction.options.getString("종목").trim();

    const amount =
      interaction.options.getInteger("수량");

    return sellStock(
      interaction,
      name,
      amount,
      false
    );
  }

  /* ===== 면세 매도 ===== */

  if (command === "면세매도") {

    const name =
      interaction.options.getString("종목").trim();

    const amount =
      interaction.options.getInteger("수량");

    return sellStock(
      interaction,
      name,
      amount,
      true
    );
  }

  /* ===== 잔액 ===== */

  if (command === "잔액") {

    const account =
      getAccount(
        interaction.user.id,
        interaction.guildId
      );

    return interaction.reply(
      `👛 **내 지갑**\n\n` +
      `💰 일반돈: **${money(cash(account))}원**\n` +
      `🛡️ 면세돈: **${money(taxCash(account))}원**`
    );
  }

  /* ===== 내 주식 ===== */

  if (command === "내주식") {

    const account =
      getAccount(
        interaction.user.id,
        interaction.guildId
      );

    let text = "📦 **내 주식**\n\n";

    for (const [name, amount] of Object.entries(account.holdings)) {

      if (amount <= 0) continue;

      const stock = data.stocks[name];

      if (!stock) continue;

      text +=
        `💰 ${name}: ${amount}주\n`;
    }

    text += "\n🛡️ **면세 주식**\n";

    for (
      const [name, amount]
      of Object.entries(account.taxFreeHoldings)
    ) {

      if (amount <= 0) continue;

      text +=
        `🛡️ ${name}: ${amount}주\n`;
    }

    return interaction.reply(text);
  }

  /* ===== 랭킹 ===== */

  if (command === "주식랭킹") {

    const ranking =
      Object.entries(data.users)
        .map(([id, account]) => {

          let total =
            cash(account) +
            taxCash(account);

          for (
            const [name, amount]
            of Object.entries(account.holdings)
          ) {

            if (data.stocks[name]) {
              total +=
                BigInt(data.stocks[name].price) *
                BigInt(amount);
            }
          }

          for (
            const [name, amount]
            of Object.entries(account.taxFreeHoldings)
          ) {

            if (data.stocks[name]) {
              total +=
                BigInt(data.stocks[name].price) *
                BigInt(amount);
            }
          }

          return {
            id,
            total
          };
        })
        .sort((a, b) =>
          a.total > b.total ? -1 :
          a.total < b.total ? 1 : 0
        );

    let text = "🏆 **주식 자산 랭킹**\n\n";

    ranking
      .slice(0, 20)
      .forEach((x, i) => {
        text +=
          `${i + 1}. <@${x.id}> — **${money(x.total)}원**\n`;
      });

    return interaction.reply(text);
  }

  /* ===== 주식 메뉴 ===== */

  if (command === "주식메뉴") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const message =
      await interaction.channel.send({
        content: stockMenuText(),
        components: [stockMenu()]
      });

    const settings =
      getGuild(interaction.guildId);

    settings.stockMenuChannelId =
      interaction.channel.id;

    settings.stockMenuMessageId =
      message.id;

    saveData();

    return interaction.reply({
      content: "✅ 주식 메뉴를 만들었습니다.",
      ephemeral: true
    });
  }

  /* ===== 돈 추가 ===== */

  if (command === "돈추가") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const target =
      interaction.options.getUser("대상");

    let amount;

    try {
      amount =
        big(
          interaction.options
            .getString("금액")
        );
    } catch {
      return interaction.reply("❌ 금액이 올바르지 않습니다.");
    }

    const account =
      getAccount(
        target.id,
        interaction.guildId
      );

    setCash(
      account,
      cash(account) + amount
    );

    saveData();

    return interaction.reply(
      `✅ ${target} 님에게 **${money(amount)}원** 추가\n` +
      `현재 일반돈: **${money(cash(account))}원**`
    );
  }

  /* ===== 돈 제거 ===== */

  if (command === "돈제거") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const target =
      interaction.options.getUser("대상");

    let amount;

    try {
      amount =
        big(
          interaction.options
            .getString("금액")
        );
    } catch {
      return interaction.reply("❌ 금액이 올바르지 않습니다.");
    }

    const account =
      getAccount(
        target.id,
        interaction.guildId
      );

    const current =
      cash(account);

    const remove =
      amount > current
        ? current
        : amount;

    setCash(
      account,
      current - remove
    );

    saveData();

    return interaction.reply(
      `✅ ${target} 님의 일반돈 **${money(remove)}원** 제거\n` +
      `현재 일반돈: **${money(cash(account))}원**`
    );
  }

  /* ===== 면세돈 추가 ===== */

  if (command === "면세돈추가") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const target =
      interaction.options.getUser("대상");

    let amount;

    try {
      amount =
        big(
          interaction.options
            .getString("금액")
        );
    } catch {
      return interaction.reply("❌ 금액이 올바르지 않습니다.");
    }

    const account =
      getAccount(
        target.id,
        interaction.guildId
      );

    setTaxCash(
      account,
      taxCash(account) + amount
    );

    saveData();

    return interaction.reply(
      `🛡️ ${target} 님에게 면세돈 **${money(amount)}원** 추가\n` +
      `현재 면세돈: **${money(taxCash(account))}원**`
    );
  }

  /* ===== 면세돈 제거 ===== */

  if (command === "면세돈제거") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const target =
      interaction.options.getUser("대상");

    let amount;

    try {
      amount =
        big(
          interaction.options
            .getString("금액")
        );
    } catch {
      return interaction.reply("❌ 금액이 올바르지 않습니다.");
    }

    const account =
      getAccount(
        target.id,
        interaction.guildId
      );

    const current =
      taxCash(account);

    const remove =
      amount > current
        ? current
        : amount;

    setTaxCash(
      account,
      current - remove
    );

    saveData();

    return interaction.reply(
      `🛡️ ${target} 님의 면세돈 **${money(remove)}원** 제거\n` +
      `현재 면세돈: **${money(taxCash(account))}원**`
    );
  }

  /* ===== 주식 추가 ===== */

  if (command === "주식추가") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const name =
      interaction.options.getString("이름").trim();

    const price =
      interaction.options.getInteger("가격");

    const type =
      interaction.options.getString("종류");

    if (data.stocks[name])
      return interaction.reply("❌ 이미 존재합니다.");

    const smallCount =
      Object.values(data.stocks)
        .filter(x => x.type === "small")
        .length;

    if (
      type === "small" &&
      smallCount >= 20
    ) {
      return interaction.reply(
        "❌ 소형주식은 최대 20종목까지 등록할 수 있습니다."
      );
    }

    data.stocks[name] = {
      price,
      type
    };

    saveData();

    return interaction.reply(
      `✅ **${name}** 추가 완료\n` +
      `종류: ${type === "small" ? "소형" : "대형"}\n` +
      `가격: ${money(price)}원`
    );
  }

  /* ===== 주식 삭제 ===== */

  if (command === "주식삭제") {

    if (!isAdmin(interaction))
      return interaction.reply("❌ 서버 관리자만 가능합니다.");

    const name =
      interaction.options.getString("이름").trim();

    if (!data.stocks[name])
      return interaction.reply("❌ 존재하지 않습니다.");

    if (
      name === "WB그룹" ||
      name === "유마그룹"
    ) {
      return interaction.reply(
        "❌ 기본 주식은 삭제할 수 없습니다."
      );
    }

    delete data.stocks[name];

    saveData();

    return interaction.reply(
      `✅ **${name}** 삭제 완료`
    );
  }

  /* ===== 주가 변경 ===== */

  if (command === "주식가격") {

    if (!isStockAdmin(interaction))
      return interaction.reply("❌ 주식 관리자만 가능합니다.");

    const name =
      interaction.options.getString("이름").trim();

    const price =
      interaction.options.getInteger("가격");

    if (!data.stocks[name])
      return interaction.reply("❌ 존재하지 않습니다.");

    data.stocks[name].price = price;

    saveData();

    return interaction.reply(
      `✅ **${name}** 가격 변경\n` +
      `현재 가격: **${money(price)}원**`
    );
  }
});

/* =========================
   5분마다 주가 변동
   -5% ~ +5%
========================= */

setInterval(async () => {

  for (const stock of Object.values(data.stocks)) {

    const percent =
      Math.random() * 10 - 5;

    stock.price =
      Math.max(
        1,
        Math.round(
          stock.price *
          (1 + percent / 100)
        )
      );
  }

  saveData();

  // 주식 메뉴 자동 갱신
  for (const guildId of Object.keys(data.guilds)) {

    const settings =
      data.guilds[guildId];

    if (
      !settings.stockMenuChannelId ||
      !settings.stockMenuMessageId
    ) continue;

    try {

      const guild =
        client.guilds.cache.get(guildId);

      if (!guild) continue;

      const channel =
        guild.channels.cache.get(
          settings.stockMenuChannelId
        );

      if (!channel) continue;

      const message =
        await channel.messages.fetch(
          settings.stockMenuMessageId
        );

      await message.edit({
        content: stockMenuText(),
        components: [stockMenu()]
      });

    } catch {}
  }

  console.log("📈 5분 주가 변동 완료");

}, 5 * 60 * 1000);

/* =========================
   웹 서버
========================= */

const app = express();

app.get("/", (req, res) => {
  res.send(
    "Discord Election + Stock Bot is running!"
  );
});

app.listen(
  process.env.PORT || 3000,
  () => {
    console.log("🌐 웹 서버 실행");
  }
);

/* =========================
   로그인
========================= */

client.login(TOKEN);
