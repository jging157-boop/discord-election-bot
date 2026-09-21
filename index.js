const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
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
   주식 설정
========================= */

const TAX_RATE = 20;

// 소형주식
const SMALL_MAX = 20;
const SMALL_MIN = 2000;

// 대형주식
const LARGE_MAX = 50;
const LARGE_MIN = 10000;

/* =========================
   기본 데이터
========================= */

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

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaultData, null, 2)
      );

      return structuredClone(defaultData);
    }

    const result = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    result.stocks ??= {};
    result.users ??= {};
    result.guilds ??= {};

    for (const stock of Object.values(result.stocks)) {
      stock.type ??= "small";
    }

    return result;
  } catch (error) {
    console.error("데이터 불러오기 오류:", error);
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
   돈 처리
========================= */

function toBigInt(value) {
  const text = String(value)
    .replace(/,/g, "")
    .trim();

  if (!/^\d+$/.test(text)) {
    throw new Error("INVALID_MONEY");
  }

  return BigInt(text);
}

function formatMoney(value) {
  return toBigInt(value).toLocaleString("ko-KR");
}

/* =========================
   서버 설정
========================= */

function getGuild(guildId) {
  data.guilds[guildId] ??= {
    startingCash: 10000,
    adminRoleId: null,
    logChannelId: null,
    stockMenuChannelId: null,
    stockMenuMessageId: null
  };

  return data.guilds[guildId];
}

/* =========================
   유저 계정
========================= */

function getAccount(userId, guildId) {
  if (!data.users[userId]) {
    const guild = getGuild(guildId);

    data.users[userId] = {
      cash: String(guild.startingCash),
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

function getCash(account) {
  return toBigInt(account.cash || 0);
}

function getTaxFreeCash(account) {
  return toBigInt(account.taxFreeCash || 0);
}

function setCash(account, value) {
  account.cash = toBigInt(value).toString();
}

function setTaxFreeCash(account, value) {
  account.taxFreeCash = toBigInt(value).toString();
}

/* =========================
   권한
========================= */

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(
    PermissionFlagsBits.Administrator
  );
}

/* =========================
   로그
========================= */

async function sendLog(interaction, title, description) {
  try {
    const guild = getGuild(interaction.guildId);

    if (!guild.logChannelId) return;

    const channel =
      interaction.guild.channels.cache.get(
        guild.logChannelId
      );

    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({
      embeds: [embed]
    });
  } catch {}
}

/* =========================
   선거
========================= */

const elections = new Map();

/* =========================
   명령어
========================= */

const commands = [

  /* 선거 */

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
    .setDescription("선거 결과를 봅니다."),

  /* 주식 */

  new SlashCommandBuilder()
    .setName("주식참여")
    .setDescription("주식 게임에 참여합니다."),

  new SlashCommandBuilder()
    .setName("주식목록")
    .setDescription("주식 목록을 봅니다."),

  new SlashCommandBuilder()
    .setName("주식메뉴")
    .setDescription("주식 거래 메뉴를 만듭니다."),

  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("일반돈으로 주식을 매수합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("구매 수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세매수")
    .setDescription("면세돈으로 주식을 매수합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("구매 수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("매도")
    .setDescription("일반 주식을 매도합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("판매 수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세매도")
    .setDescription("면세 주식을 매도합니다.")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("판매 수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("잔액")
    .setDescription("내 지갑을 봅니다."),

  new SlashCommandBuilder()
    .setName("내주식")
    .setDescription("내 주식을 봅니다."),

  new SlashCommandBuilder()
    .setName("주식랭킹")
    .setDescription("주식 자산 랭킹을 봅니다."),

  /* 돈 */

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

  /* 관리자 주식 */

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
        .setDescription("주식 종류")
        .addChoices(
          {
            name: "소형주식",
            value: "small"
          },
          {
            name: "대형주식",
            value: "large"
          }
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
        .setDescription("새 가격")
        .setMinValue(1)
        .setRequired(true)
    )

].map(command => command.toJSON());

/* =========================
   봇 준비
========================= */

client.once("ready", async () => {

  console.log(
    `✅ ${client.user.tag} 로그인 완료`
  );

  try {

    const rest = new REST({
      version: "10"
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("✅ 슬래시 명령어 등록 완료");

  } catch (error) {
    console.error(
      "명령어 등록 오류:",
      error
    );
  }
});

/* =========================
   세금
========================= */

function calculateTax(amount) {
  return (
    amount * BigInt(TAX_RATE)
  ) / 100n;
}

/* =========================
   주식 제한
========================= */

function getStockMax(stock) {
  return stock.type === "large"
    ? LARGE_MAX
    : SMALL_MAX;
}

function getMinimumPrice(stock) {
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
  quantity,
  taxFree
) {

  const stock = data.stocks[name];

  if (!stock) {
    return interaction.reply(
      "❌ 존재하지 않는 주식입니다."
    );
  }

  const max =
    getStockMax(stock);

  if (quantity > max) {
    return interaction.reply(
      `❌ 이 주식은 한 번에 최대 **${max}주**까지 구매할 수 있습니다.`
    );
  }

  const account =
    getAccount(
      interaction.user.id,
      interaction.guildId
    );

  const price =
    BigInt(stock.price);

  const stockCost =
    price * BigInt(quantity);

  const minimum =
    BigInt(getMinimumPrice(stock));

  /* 최소 구매금액 */

  if (stockCost < minimum) {
    return interaction.reply(
      `❌ ${stock.type === "small" ? "소형" : "대형"}주식 최소 구매금액은 **${formatMoney(minimum)}원**입니다.\n` +
      `현재 금액: **${formatMoney(stockCost)}원**`
    );
  }

  /* =====================
     면세돈 매수
  ===================== */

  if (taxFree) {

    const balance =
      getTaxFreeCash(account);

    if (balance < stockCost) {
      return interaction.reply(
        `❌ 면세돈이 부족합니다.\n\n` +
        `필요: **${formatMoney(stockCost)}원**\n` +
        `보유: **${formatMoney(balance)}원**`
      );
    }

    // 면세돈 자동 차감
    setTaxFreeCash(
      account,
      balance - stockCost
    );

    account.taxFreeHoldings[name] =
      (account.taxFreeHoldings[name] || 0) +
      quantity;

    saveData();

    await sendLog(
      interaction,
      "🛡️ 면세 주식 매수",
      `${interaction.user} 님이 ${name} ${quantity}주를 면세돈으로 구매\n` +
      `사용 금액: ${formatMoney(stockCost)}원`
    );

    return interaction.reply(
      `🛡️ **면세 주식 매수 완료**\n\n` +
      `📈 종목: **${name}**\n` +
      `📦 수량: **${quantity}주**\n` +
      `💸 사용 면세돈: **${formatMoney(stockCost)}원**\n` +
      `🧾 세금: **0원**\n\n` +
      `🛡️ 남은 면세돈: **${formatMoney(getTaxFreeCash(account))}원**`
    );
  }

  /* =====================
     일반돈 매수
  ===================== */

  const tax =
    calculateTax(stockCost);

  const total =
    stockCost + tax;

  const balance =
    getCash(account);

  if (balance < total) {
    return interaction.reply(
      `❌ 일반돈이 부족합니다.\n\n` +
      `📈 주식가격: **${formatMoney(stockCost)}원**\n` +
      `🧾 세금 ${TAX_RATE}%: **${formatMoney(tax)}원**\n` +
      `💰 총 필요금액: **${formatMoney(total)}원**\n` +
      `💵 보유금액: **${formatMoney(balance)}원**`
    );
  }

  setCash(
    account,
    balance - total
  );

  account.holdings[name] =
    (account.holdings[name] || 0) +
    quantity;

  saveData();

  await sendLog(
    interaction,
    "💰 일반 주식 매수",
    `${interaction.user} 님이 ${name} ${quantity}주 구매\n` +
    `주식가격: ${formatMoney(stockCost)}원\n` +
    `세금: ${formatMoney(tax)}원`
  );

  return interaction.reply(
    `✅ **주식 매수 완료**\n\n` +
    `📈 종목: **${name}**\n` +
    `📦 수량: **${quantity}주**\n` +
    `💸 주식가격: **${formatMoney(stockCost)}원**\n` +
    `🧾 세금 ${TAX_RATE}%: **${formatMoney(tax)}원**\n` +
    `💰 총 사용금액: **${formatMoney(total)}원**`
  );
}

/* =========================
   주식 매도
========================= */

async function sellStock(
  interaction,
  name,
  quantity,
  taxFree
) {

  const stock =
    data.stocks[name];

  if (!stock) {
    return interaction.reply(
      "❌ 존재하지 않는 주식입니다."
    );
  }

  const account =
    getAccount(
      interaction.user.id,
      interaction.guildId
    );

  const holdings =
    taxFree
      ? account.taxFreeHoldings
      : account.holdings;

  const owned =
    holdings[name] || 0;

  if (owned < quantity) {
    return interaction.reply(
      `❌ 주식이 부족합니다.\n` +
      `보유량: **${owned}주**`
    );
  }

  const salePrice =
    BigInt(stock.price) *
    BigInt(quantity);

  holdings[name] -= quantity;

  if (holdings[name] <= 0) {
    delete holdings[name];
  }

  /* 면세 주식 */

  if (taxFree) {

    setTaxFreeCash(
      account,
      getTaxFreeCash(account) +
      salePrice
    );

    saveData();

    return interaction.reply(
      `🛡️ **면세 주식 매도 완료**\n\n` +
      `📈 종목: **${name}**\n` +
      `📦 수량: **${quantity}주**\n` +
      `💰 받은 면세돈: **${formatMoney(salePrice)}원**\n` +
      `🧾 세금: **0원**`
    );
  }

  /* 일반 주식 */

  const tax =
    calculateTax(salePrice);

  const receive =
    salePrice - tax;

  setCash(
    account,
    getCash(account) +
    receive
  );

  saveData();

  return interaction.reply(
    `✅ **주식 매도 완료**\n\n` +
    `📈 종목: **${name}**\n` +
    `📦 수량: **${quantity}주**\n` +
    `💵 판매금액: **${formatMoney(salePrice)}원**\n` +
    `🧾 세금 ${TAX_RATE}%: **${formatMoney(tax)}원**\n` +
    `💰 받은 돈: **${formatMoney(receive)}원**`
  );
}

/* =========================
   주식 메뉴
========================= */

function makeStockMenu() {

  const row =
    new ActionRowBuilder()
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
          .setCustomId("sell_normal")
          .setLabel("📉 일반 주식 매도")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId("sell_taxfree")
          .setLabel("🛡️ 면세 주식 매도")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId("wallet")
          .setLabel("👛 내 지갑")
          .setStyle(ButtonStyle.Secondary)
      );

  return row;
}

function makeStockMenuText() {

  let text =
    "📈 **주식 거래소**\n\n";

  for (
    const [name, stock]
    of Object.entries(data.stocks)
  ) {

    text +=
      `${stock.type === "large" ? "🔵 대형" : "🟢 소형"} ` +
      `**${name}** — **${formatMoney(stock.price)}원**\n`;
  }

  text +=
    `\n🟢 소형 최소 구매: **2,000원**` +
    `\n🔵 대형 최소 구매: **10,000원**` +
    `\n🧾 일반 거래 세금: **20%**` +
    `\n🛡️ 면세 거래 세금: **0%**`;

  return text;
}

/* =========================
   버튼 처리
========================= */

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isButton()) return;

    /* 지갑 */

    if (
      interaction.customId === "wallet"
    ) {

      const account =
        getAccount(
          interaction.user.id,
          interaction.guildId
        );

      return interaction.reply({
        content:
          `👛 **내 지갑**\n\n` +
          `💰 일반돈: **${formatMoney(getCash(account))}원**\n` +
          `🛡️ 면세돈: **${formatMoney(getTaxFreeCash(account))}원**`,
        ephemeral: true
      });
    }

    /* 매수 / 매도 */

    const modal =
      new ModalBuilder();

    if (
      interaction.customId ===
      "buy_normal"
    ) {

      modal
        .setCustomId("modal_buy_normal")
        .setTitle("💰 일반돈으로 매수");

    } else if (
      interaction.customId ===
      "buy_taxfree"
    ) {

      modal
        .setCustomId("modal_buy_taxfree")
        .setTitle("🛡️ 면세돈으로 매수");

    } else if (
      interaction.customId ===
      "sell_normal"
    ) {

      modal
        .setCustomId("modal_sell_normal")
        .setTitle("📉 일반 주식 매도");

    } else if (
      interaction.customId ===
      "sell_taxfree"
    ) {

      modal
        .setCustomId("modal_sell_taxfree")
        .setTitle("🛡️ 면세 주식 매도");

    } else {
      return;
    }

    const stockInput =
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
        .addComponents(stockInput),

      new ActionRowBuilder()
        .addComponents(amountInput)

    );

    return interaction.showModal(modal);
  }
);

/* =========================
   모달 처리
========================= */

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isModalSubmit())
      return;

    const name =
      interaction.fields
        .getTextInputValue("stock")
        .trim();

    const amountText =
      interaction.fields
        .getTextInputValue("amount")
        .trim();

    const quantity =
      Number(amountText);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return interaction.reply(
        "❌ 수량은 1 이상의 숫자여야 합니다."
      );
    }

    if (
      interaction.customId ===
      "modal_buy_normal"
    ) {
      return buyStock(
        interaction,
        name,
        quantity,
        false
      );
    }

    if (
      interaction.customId ===
      "modal_buy_taxfree"
    ) {
      return buyStock(
        interaction,
        name,
        quantity,
        true
      );
    }

    if (
      interaction.customId ===
      "modal_sell_normal"
    ) {
      return sellStock(
        interaction,
        name,
        quantity,
        false
      );
    }

    if (
      interaction.customId ===
      "modal_sell_taxfree"
    ) {
      return sellStock(
        interaction,
        name,
        quantity,
        true
      );
    }
  }
);

/* =========================
   슬래시 명령어
========================= */

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isChatInputCommand())
      return;

    if (!interaction.guildId)
      return;

    const command =
      interaction.commandName;

    /* =====================
       선거
    ===================== */

    if (command === "선거시작") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      if (
        elections.get(interaction.guildId)
          ?.active
      ) {
        return interaction.reply(
          "❌ 이미 선거가 진행 중입니다."
        );
      }

      elections.set(
        interaction.guildId,
        {
          active: true,
          candidates: new Map(),
          voters: new Set()
        }
      );

      return interaction.reply(
        "🗳️ **선거가 시작되었습니다!**"
      );
    }

    if (command === "후보등록") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const election =
        elections.get(
          interaction.guildId
        );

      if (!election?.active)
        return interaction.reply(
          "❌ 진행 중인 선거가 없습니다."
        );

      if (
        election.candidates.size >= 20
      ) {
        return interaction.reply(
          "❌ 후보는 최대 20명입니다."
        );
      }

      const name =
        interaction.options
          .getString("이름")
          .trim();

      if (
        election.candidates.has(name)
      ) {
        return interaction.reply(
          "❌ 이미 등록된 후보입니다."
        );
      }

      election.candidates.set(
        name,
        0
      );

      return interaction.reply(
        `✅ **${name}** 후보 등록 완료`
      );
    }

    if (command === "투표") {

      const election =
        elections.get(
          interaction.guildId
        );

      if (!election?.active)
        return interaction.reply(
          "❌ 진행 중인 선거가 없습니다."
        );

      if (
        election.voters.has(
          interaction.user.id
        )
      ) {
        return interaction.reply(
          "❌ 이미 투표했습니다."
        );
      }

      const name =
        interaction.options
          .getString("후보")
          .trim();

      if (
        !election.candidates.has(name)
      ) {
        return interaction.reply(
          "❌ 존재하지 않는 후보입니다."
        );
      }

      election.candidates.set(
        name,
        election.candidates.get(name) + 1
      );

      election.voters.add(
        interaction.user.id
      );

      return interaction.reply(
        `✅ **${name}** 후보에게 투표했습니다.`
      );
    }

    if (command === "선거종료") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const election =
        elections.get(
          interaction.guildId
        );

      if (!election?.active)
        return interaction.reply(
          "❌ 진행 중인 선거가 없습니다."
        );

      election.active = false;

      return interaction.reply(
        "🛑 **선거가 종료되었습니다.**"
      );
    }

    if (command === "결과") {

      const election =
        elections.get(
          interaction.guildId
        );

      if (!election)
        return interaction.reply(
          "❌ 선거가 없습니다."
        );

      const result =
        [...election.candidates.entries()]
          .sort(
            (a, b) => b[1] - a[1]
          );

      let text =
        "📊 **선거 결과**\n\n";

      result.forEach(
        ([name, votes], index) => {
          text +=
            `${index + 1}. **${name}** — ${votes}표\n`;
        }
      );

      text +=
        `\n👥 총 투표자: ${election.voters.size}명`;

      return interaction.reply(text);
    }

    /* =====================
       주식 참여
    ===================== */

    if (command === "주식참여") {

      if (data.users[interaction.user.id]) {
        return interaction.reply(
          "❌ 이미 주식 게임에 참여하고 있습니다."
        );
      }

      const guild =
        getGuild(interaction.guildId);

      data.users[interaction.user.id] = {
        cash: String(guild.startingCash),
        taxFreeCash: "0",
        holdings: {},
        taxFreeHoldings: {}
      };

      saveData();

      return interaction.reply(
        `✅ 주식 게임 참여 완료!\n` +
        `💰 시작금: **${formatMoney(guild.startingCash)}원**`
      );
    }

    /* =====================
       주식 목록
    ===================== */

    if (command === "주식목록") {

      let text =
        "📈 **주식 목록**\n\n";

      for (
        const [name, stock]
        of Object.entries(data.stocks)
      ) {

        text +=
          `${stock.type === "large" ? "🔵 대형" : "🟢 소형"} ` +
          `**${name}** — ${formatMoney(stock.price)}원\n`;
      }

      return interaction.reply(text);
    }

    /* =====================
       일반 매수
    ===================== */

    if (command === "매수") {

      const name =
        interaction.options
          .getString("종목")
          .trim();

      const quantity =
        interaction.options
          .getInteger("수량");

      return buyStock(
        interaction,
        name,
        quantity,
        false
      );
    }

    /* =====================
       면세 매수
    ===================== */

    if (command === "면세매수") {

      const name =
        interaction.options
          .getString("종목")
          .trim();

      const quantity =
        interaction.options
          .getInteger("수량");

      return buyStock(
        interaction,
        name,
        quantity,
        true
      );
    }

    /* =====================
       일반 매도
    ===================== */

    if (command === "매도") {

      const name =
        interaction.options
          .getString("종목")
          .trim();

      const quantity =
        interaction.options
          .getInteger("수량");

      return sellStock(
        interaction,
        name,
        quantity,
        false
      );
    }

    /* =====================
       면세 매도
    ===================== */

    if (command === "면세매도") {

      const name =
        interaction.options
          .getString("종목")
          .trim();

      const quantity =
        interaction.options
          .getInteger("수량");

      return sellStock(
        interaction,
        name,
        quantity,
        true
      );
    }

    /* =====================
       잔액
    ===================== */

    if (command === "잔액") {

      const account =
        getAccount(
          interaction.user.id,
          interaction.guildId
        );

      return interaction.reply(
        `👛 **내 지갑**\n\n` +
        `💰 일반돈: **${formatMoney(getCash(account))}원**\n` +
        `🛡️ 면세돈: **${formatMoney(getTaxFreeCash(account))}원**`
      );
    }

    /* =====================
       내 주식
    ===================== */

    if (command === "내주식") {

      const account =
        getAccount(
          interaction.user.id,
          interaction.guildId
        );

      let text =
        "📦 **내 일반 주식**\n\n";

      let hasNormal = false;

      for (
        const [name, quantity]
        of Object.entries(account.holdings)
      ) {

        if (quantity <= 0)
          continue;

        text +=
          `💰 ${name}: ${quantity}주\n`;

        hasNormal = true;
      }

      if (!hasNormal)
        text += "없음\n";

      text +=
        "\n🛡️ **내 면세 주식**\n\n";

      let hasTaxFree = false;

      for (
        const [name, quantity]
        of Object.entries(
          account.taxFreeHoldings
        )
      ) {

        if (quantity <= 0)
          continue;

        text +=
          `🛡️ ${name}: ${quantity}주\n`;

        hasTaxFree = true;
      }

      if (!hasTaxFree)
        text += "없음";

      return interaction.reply(text);
    }

    /* =====================
       주식 랭킹
    ===================== */

    if (command === "주식랭킹") {

      const ranking =
        Object.entries(data.users)
          .map(([id, account]) => {

            let total =
              getCash(account) +
              getTaxFreeCash(account);

            for (
              const [name, quantity]
              of Object.entries(
                account.holdings
              )
            ) {

              const stock =
                data.stocks[name];

              if (!stock)
                continue;

              total +=
                BigInt(stock.price) *
                BigInt(quantity);
            }

            for (
              const [name, quantity]
              of Object.entries(
                account.taxFreeHoldings
              )
            ) {

              const stock =
                data.stocks[name];

              if (!stock)
                continue;

              total +=
                BigInt(stock.price) *
                BigInt(quantity);
            }

            return {
              id,
              total
            };
          })
          .sort((a, b) => {

            if (a.total > b.total)
              return -1;

            if (a.total < b.total)
              return 1;

            return 0;
          });

      let text =
        "🏆 **주식 자산 랭킹**\n\n";

      ranking
        .slice(0, 20)
        .forEach((item, index) => {

          text +=
            `${index + 1}. <@${item.id}> — **${formatMoney(item.total)}원**\n`;
        });

      return interaction.reply(text);
    }

    /* =====================
       주식 메뉴
    ===================== */

    if (command === "주식메뉴") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const message =
        await interaction.channel.send({
          content:
            makeStockMenuText(),
          components: [
            makeStockMenu()
          ]
        });

      const guild =
        getGuild(interaction.guildId);

      guild.stockMenuChannelId =
        interaction.channel.id;

      guild.stockMenuMessageId =
        message.id;

      saveData();

      return interaction.reply({
        content:
          "✅ 주식 메뉴가 생성되었습니다.",
        ephemeral: true
      });
    }

    /* =====================
       돈 추가
    ===================== */

    if (command === "돈추가") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const target =
        interaction.options
          .getUser("대상");

      let amount;

      try {
        amount =
          toBigInt(
            interaction.options
              .getString("금액")
          );
      } catch {
        return interaction.reply(
          "❌ 금액이 올바르지 않습니다."
        );
      }

      const account =
        getAccount(
          target.id,
          interaction.guildId
        );

      setCash(
        account,
        getCash(account) + amount
      );

      saveData();

      await sendLog(
        interaction,
        "💰 돈 추가",
        `${target} 님에게 ${formatMoney(amount)}원 추가`
      );

      return interaction.reply(
        `✅ ${target} 님에게 **${formatMoney(amount)}원** 추가\n` +
        `현재 일반돈: **${formatMoney(getCash(account))}원**`
      );
    }

    /* =====================
       돈 제거
    ===================== */

    if (command === "돈제거") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const target =
        interaction.options
          .getUser("대상");

      let amount;

      try {
        amount =
          toBigInt(
            interaction.options
              .getString("금액")
          );
      } catch {
        return interaction.reply(
          "❌ 금액이 올바르지 않습니다."
        );
      }

      const account =
        getAccount(
          target.id,
          interaction.guildId
        );

      const balance =
        getCash(account);

      const remove =
        amount > balance
          ? balance
          : amount;

      setCash(
        account,
        balance - remove
      );

      saveData();

      return interaction.reply(
        `✅ ${target} 님의 일반돈 **${formatMoney(remove)}원** 제거\n` +
        `현재 일반돈: **${formatMoney(getCash(account))}원**`
      );
    }

    /* =====================
       면세돈 추가
    ===================== */

    if (command === "면세돈추가") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const target =
        interaction.options
          .getUser("대상");

      let amount;

      try {
        amount =
          toBigInt(
            interaction.options
              .getString("금액")
          );
      } catch {
        return interaction.reply(
          "❌ 금액이 올바르지 않습니다."
        );
      }

      const account =
        getAccount(
          target.id,
          interaction.guildId
        );

      setTaxFreeCash(
        account,
        getTaxFreeCash(account) +
        amount
      );

      saveData();

      return interaction.reply(
        `🛡️ ${target} 님에게 면세돈 **${formatMoney(amount)}원** 추가\n` +
        `현재 면세돈: **${formatMoney(getTaxFreeCash(account))}원**`
      );
    }

    /* =====================
       면세돈 제거
    ===================== */

    if (command === "면세돈제거") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const target =
        interaction.options
          .getUser("대상");

      let amount;

      try {
        amount =
          toBigInt(
            interaction.options
              .getString("금액")
          );
      } catch {
        return interaction.reply(
          "❌ 금액이 올바르지 않습니다."
        );
      }

      const account =
        getAccount(
          target.id,
          interaction.guildId
        );

      const balance =
        getTaxFreeCash(account);

      const remove =
        amount > balance
          ? balance
          : amount;

      setTaxFreeCash(
        account,
        balance - remove
      );

      saveData();

      return interaction.reply(
        `🛡️ ${target} 님의 면세돈 **${formatMoney(remove)}원** 제거\n` +
        `현재 면세돈: **${formatMoney(getTaxFreeCash(account))}원**`
      );
    }

    /* =====================
       주식 추가
    ===================== */

    if (command === "주식추가") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const name =
        interaction.options
          .getString("이름")
          .trim();

      const price =
        interaction.options
          .getInteger("가격");

      const type =
        interaction.options
          .getString("종류");

      if (data.stocks[name]) {
        return interaction.reply(
          "❌ 이미 존재하는 주식입니다."
        );
      }

      const smallCount =
        Object.values(data.stocks)
          .filter(
            stock => stock.type === "small"
          )
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

      await updateAllStockMenus();

      return interaction.reply(
        `✅ **${name}** 주식 추가 완료\n\n` +
        `종류: **${type === "small" ? "소형주식" : "대형주식"}**\n` +
        `가격: **${formatMoney(price)}원**`
      );
    }

    /* =====================
       주식 삭제
    ===================== */

    if (command === "주식삭제") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const name =
        interaction.options
          .getString("이름")
          .trim();

      if (!data.stocks[name]) {
        return interaction.reply(
          "❌ 존재하지 않는 주식입니다."
        );
      }

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

      await updateAllStockMenus();

      return interaction.reply(
        `✅ **${name}** 주식 삭제 완료`
      );
    }

    /* =====================
       주식 가격 변경
    ===================== */

    if (command === "주식가격") {

      if (!isAdmin(interaction))
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );

      const name =
        interaction.options
          .getString("이름")
          .trim();

      const price =
        interaction.options
          .getInteger("가격");

      if (!data.stocks[name]) {
        return interaction.reply(
          "❌ 존재하지 않는 주식입니다."
        );
      }

      data.stocks[name].price =
        price;

      saveData();

      await updateAllStockMenus();

      return interaction.reply(
        `✅ **${name}** 가격 변경 완료\n` +
        `현재 가격: **${formatMoney(price)}원**`
      );
    }
  }
);

/* =========================
   모든 주식 메뉴 업데이트
========================= */

async function updateAllStockMenus() {

  for (
    const guildId of Object.keys(data.guilds)
  ) {

    const settings =
      data.guilds[guildId];

    if (
      !settings.stockMenuChannelId ||
      !settings.stockMenuMessageId
    ) {
      continue;
    }

    try {

      const guild =
        client.guilds.cache.get(
          guildId
        );

      if (!guild)
        continue;

      const channel =
        guild.channels.cache.get(
          settings.stockMenuChannelId
        );

      if (!channel)
        continue;

      const message =
        await channel.messages.fetch(
          settings.stockMenuMessageId
        );

      await message.edit({
        content:
          makeStockMenuText(),
        components: [
          makeStockMenu()
        ]
      });

    } catch {}
  }
}

/* =========================
   5분마다 주가 변동
   -5% ~ +5%
========================= */

setInterval(
  async () => {

    for (
      const stock
      of Object.values(data.stocks)
    ) {

      const change =
        Math.random() * 10 - 5;

      stock.price =
        Math.max(
          1,
          Math.round(
            stock.price *
            (1 + change / 100)
          )
        );
    }

    saveData();

    await updateAllStockMenus();

    console.log(
      "📈 주가 자동 변동 완료"
    );

  },
  5 * 60 * 1000
);

/* =========================
   웹 서버
========================= */

const app =
  express();

app.get(
  "/",
  (req, res) => {
    res.send(
      "Discord Election + Stock Bot is running!"
    );
  }
);

app.listen(
  process.env.PORT || 3000,
  () => {
    console.log(
      "🌐 웹 서버 실행 완료"
    );
  }
);

/* =========================
   로그인
========================= */

client.login(TOKEN);
