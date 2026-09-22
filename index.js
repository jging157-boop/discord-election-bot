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
  console.error("DISCORD_TOKEN 또는 CLIENT_ID가 없습니다.");
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, "stock-data.json");

const SMALL_MIN = 2000;
const LARGE_MIN = 10000;
const SMALL_MAX = 20;
const LARGE_MAX = 50;
const MAX_SMALL_STOCKS = 20;
const DEFAULT_TAX_RATE = 20;

const DEFAULT_STOCKS = {
  "WB그룹": { price: 1000, type: "small" },
  "유마그룹": { price: 1000, type: "small" }
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

let data = {
  users: {},
  stocks: {},
  guilds: {}
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      data = {
        users: raw.users || {},
        stocks: raw.stocks || {},
        guilds: raw.guilds || {}
      };
    }
  } catch (e) {
    console.error("데이터 불러오기 실패:", e);
  }

  if (!Object.keys(data.stocks).length) {
    data.stocks = structuredClone(DEFAULT_STOCKS);
  }

  for (const [name, stock] of Object.entries(data.stocks)) {
    if (typeof stock === "number") {
      data.stocks[name] = {
        price: stock,
        type: "small"
      };
    } else {
      stock.price = Number(stock.price) || 1;
      stock.type = stock.type === "large" ? "large" : "small";
    }
  }

  for (const guild of Object.values(data.guilds)) {
    if (!guild.taxRate && guild.taxRate !== 0) {
      guild.taxRate = DEFAULT_TAX_RATE;
    }
  }

  saveData();
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("데이터 저장 실패:", e);
  }
}

loadData();

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      taxRate: DEFAULT_TAX_RATE,
      logChannelId: null,
      stockMenuChannelId: null,
      stockMenuMessageId: null
    };
  }

  if (
    data.guilds[guildId].taxRate === undefined ||
    data.guilds[guildId].taxRate === null
  ) {
    data.guilds[guildId].taxRate = DEFAULT_TAX_RATE;
  }

  return data.guilds[guildId];
}

function getAccount(userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      money: "0",
      taxFreeMoney: "0",
      stocks: {},
      taxFreeStocks: {}
    };
  }

  const a = data.users[userId];

  a.money = String(a.money ?? "0");
  a.taxFreeMoney = String(a.taxFreeMoney ?? "0");
  a.stocks = a.stocks || {};
  a.taxFreeStocks = a.taxFreeStocks || {};

  return a;
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );
}

function deleteLater(interaction, ms = 10000) {
  setTimeout(async () => {
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.deleteReply().catch(() => {});
      }
    } catch {}
  }, ms);
}

async function replyAndDelete(interaction, content, ms = 10000) {
  try {
    await interaction.reply({
      content,
      ephemeral: false
    });
    deleteLater(interaction, ms);
  } catch (e) {
    console.error(e);
  }
}

async function sendLog(guildId, title, description) {
  try {
    const guildSettings = getGuild(guildId);

    if (!guildSettings.logChannelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(guildSettings.logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error("로그 전송 실패:", e);
  }
}

function formatMoney(value) {
  try {
    return BigInt(value).toLocaleString("ko-KR");
  } catch {
    return "0";
  }
}

function validAmount(value) {
  return /^\d+$/.test(String(value)) && BigInt(value) >= 0n;
}

function getTaxRate(guildId) {
  return Number(getGuild(guildId).taxRate ?? DEFAULT_TAX_RATE);
}

function taxOf(amount, rate) {
  return (amount * BigInt(rate)) / 100n;
}

function stockLimit(stock) {
  return stock.type === "large" ? LARGE_MAX : SMALL_MAX;
}

function stockMinimum(stock) {
  return stock.type === "large" ? LARGE_MIN : SMALL_MIN;
}

function stockTypeText(type) {
  return type === "large" ? "대형" : "소형";
}

function stockListText() {
  const entries = Object.entries(data.stocks);

  if (!entries.length) {
    return "현재 등록된 주식이 없습니다.";
  }

  return entries
    .map(([name, stock]) => {
      return `• **${name}** | ${formatMoney(stock.price)}원 | ${stockTypeText(stock.type)} | 최소 ${formatMoney(stockMinimum(stock))}원`;
    })
    .join("\n");
}

function makeStockEmbed(guildId) {
  const tax = getTaxRate(guildId);

  return new EmbedBuilder()
    .setTitle("🏦 주식 거래소")
    .setDescription(
      `현재 세율: **${tax}%**\n\n` +
      stockListText() +
      `\n\n📌 소형 1회 최대 ${SMALL_MAX}주\n` +
      `📌 대형 1회 최대 ${LARGE_MAX}주\n` +
      `📌 주가는 5분마다 최대 ±5% 변동`
    )
    .setTimestamp();
}

function stockButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("buy_normal")
        .setLabel("일반돈으로 매수")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("buy_taxfree")
        .setLabel("면세돈으로 매수")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("sell_normal")
        .setLabel("매도")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("sell_taxfree")
        .setLabel("면세매도")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("wallet")
        .setLabel("내 지갑")
        .setStyle(ButtonStyle.Secondary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("my_stocks")
        .setLabel("내 주식")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_ranking")
        .setLabel("주식 랭킹")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_list")
        .setLabel("주식 목록")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function updateStockMenu(guildId) {
  try {
    const settings = getGuild(guildId);

    if (!settings.stockMenuChannelId || !settings.stockMenuMessageId) {
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(settings.stockMenuChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages
      .fetch(settings.stockMenuMessageId)
      .catch(() => null);

    if (!message) return;

    await message.edit({
      embeds: [makeStockEmbed(guildId)],
      components: stockButtons()
    });
  } catch (e) {
    console.error("주식 메뉴 업데이트 실패:", e);
  }
}

async function updateAllStockMenus() {
  for (const guild of client.guilds.cache.values()) {
    await updateStockMenu(guild.id);
  }
}

async function createStockMenu(interaction) {
  const message = await interaction.channel.send({
    embeds: [makeStockEmbed(interaction.guildId)],
    components: stockButtons()
  });

  const settings = getGuild(interaction.guildId);

  settings.stockMenuChannelId = interaction.channelId;
  settings.stockMenuMessageId = message.id;

  saveData();

  return message;
}

async function tradeBuy(
  interaction,
  stockName,
  quantity,
  taxFree = false
) {
  const stock = data.stocks[stockName];

  if (!stock) {
    return replyAndDelete(interaction, "❌ 존재하지 않는 주식입니다.");
  }

  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) {
    return replyAndDelete(interaction, "❌ 수량이 올바르지 않습니다.");
  }

  const max = stockLimit(stock);

  if (qty > max) {
    return replyAndDelete(
      interaction,
      `❌ ${stockTypeText(stock.type)} 주식은 한 번에 최대 ${max}주까지 매수할 수 있습니다.`
    );
  }

  const subtotal = BigInt(stock.price) * BigInt(qty);

  if (subtotal < BigInt(stockMinimum(stock))) {
    return replyAndDelete(
      interaction,
      `❌ 최소 매수 금액은 ${formatMoney(stockMinimum(stock))}원입니다.`
    );
  }

  const account = getAccount(interaction.user.id);
  const rate = taxFree ? 0 : getTaxRate(interaction.guildId);
  const tax = taxOf(subtotal, rate);
  const total = subtotal + tax;

  const moneyKey = taxFree ? "taxFreeMoney" : "money";

  if (BigInt(account[moneyKey]) < total) {
    return replyAndDelete(
      interaction,
      `❌ 돈이 부족합니다.\n필요: ${formatMoney(total)}원\n보유: ${formatMoney(account[moneyKey])}원`
    );
  }

  account[moneyKey] = (
    BigInt(account[moneyKey]) - total
  ).toString();

  const holdingsKey = taxFree ? "taxFreeStocks" : "stocks";

  account[holdingsKey][stockName] =
    Number(account[holdingsKey][stockName] || 0) + qty;

  saveData();

  await sendLog(
    interaction.guildId,
    taxFree ? "🛡️ 면세 주식 매수" : "📈 주식 매수",
    [
      `사용자: ${interaction.user}`,
      `종목: **${stockName}**`,
      `수량: **${qty}주**`,
      `주식 금액: **${formatMoney(subtotal)}원**`,
      `세금: **${formatMoney(tax)}원**`,
      `총액: **${formatMoney(total)}원**`
    ].join("\n")
  );

  await replyAndDelete(
    interaction,
    `✅ ${stockName} ${qty}주 매수 완료!\n` +
      `총 ${formatMoney(total)}원 사용\n` +
      `세금 ${formatMoney(tax)}원`
  );

  await updateAllStockMenus();
}

async function tradeSell(
  interaction,
  stockName,
  quantity,
  taxFree = false
) {
  const stock = data.stocks[stockName];

  if (!stock) {
    return replyAndDelete(interaction, "❌ 존재하지 않는 주식입니다.");
  }

  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) {
    return replyAndDelete(interaction, "❌ 수량이 올바르지 않습니다.");
  }

  const max = stockLimit(stock);

  if (qty > max) {
    return replyAndDelete(
      interaction,
      `❌ 한 번에 최대 ${max}주까지 매도할 수 있습니다.`
    );
  }

  const account = getAccount(interaction.user.id);
  const holdingsKey = taxFree ? "taxFreeStocks" : "stocks";

  const owned = Number(account[holdingsKey][stockName] || 0);

  if (owned < qty) {
    return replyAndDelete(
      interaction,
      `❌ 보유 주식이 부족합니다.\n보유: ${owned}주`
    );
  }

  const gross = BigInt(stock.price) * BigInt(qty);
  const rate = taxFree ? 0 : getTaxRate(interaction.guildId);
  const tax = taxOf(gross, rate);
  const received = gross - tax;

  account[holdingsKey][stockName] = owned - qty;

  if (account[holdingsKey][stockName] <= 0) {
    delete account[holdingsKey][stockName];
  }

  const moneyKey = taxFree ? "taxFreeMoney" : "money";

  account[moneyKey] = (
    BigInt(account[moneyKey]) + received
  ).toString();

  saveData();

  await sendLog(
    interaction.guildId,
    taxFree ? "🛡️ 면세 주식 매도" : "📉 주식 매도",
    [
      `사용자: ${interaction.user}`,
      `종목: **${stockName}**`,
      `수량: **${qty}주**`,
      `판매 금액: **${formatMoney(gross)}원**`,
      `세금: **${formatMoney(tax)}원**`,
      `받은 돈: **${formatMoney(received)}원**`
    ].join("\n")
  );

  await replyAndDelete(
    interaction,
    `✅ ${stockName} ${qty}주 매도 완료!\n` +
      `받은 돈: ${formatMoney(received)}원\n` +
      `세금: ${formatMoney(tax)}원`
  );

  await updateAllStockMenus();
}

function walletText(userId) {
  const account = getAccount(userId);

  return (
    `💰 일반돈: **${formatMoney(account.money)}원**\n` +
    `🛡️ 면세돈: **${formatMoney(account.taxFreeMoney)}원**`
  );
}

function holdingsText(userId) {
  const account = getAccount(userId);

  const normal = Object.entries(account.stocks);
  const taxFree = Object.entries(account.taxFreeStocks);

  let text = "📊 **내 주식**\n\n";

  if (!normal.length && !taxFree.length) {
    return text + "보유 주식이 없습니다.";
  }

  if (normal.length) {
    text += "일반 주식\n";
    for (const [name, qty] of normal) {
      const price = data.stocks[name]?.price || 0;
      text += `• ${name}: ${qty}주 (${formatMoney(price * qty)}원)\n`;
    }
  }

  if (taxFree.length) {
    text += "\n면세 주식\n";
    for (const [name, qty] of taxFree) {
      const price = data.stocks[name]?.price || 0;
      text += `• ${name}: ${qty}주 (${formatMoney(price * qty)}원)\n`;
    }
  }

  return text;
}

function portfolioValue(userId) {
  const account = getAccount(userId);

  let total =
    BigInt(account.money) +
    BigInt(account.taxFreeMoney);

  for (const [name, qty] of Object.entries(account.stocks)) {
    if (data.stocks[name]) {
      total += BigInt(data.stocks[name].price) * BigInt(qty);
    }
  }

  for (const [name, qty] of Object.entries(account.taxFreeStocks)) {
    if (data.stocks[name]) {
      total += BigInt(data.stocks[name].price) * BigInt(qty);
    }
  }

  return total;
}

async function rankingText(guild) {
  const entries = Object.keys(data.users)
    .map(id => ({
      id,
      value: portfolioValue(id)
    }))
    .sort((a, b) => {
      if (a.value > b.value) return -1;
      if (a.value < b.value) return 1;
      return 0;
    })
    .slice(0, 10);

  if (!entries.length) {
    return "아직 참가자가 없습니다.";
  }

  let text = "🏆 **주식 자산 랭킹**\n\n";

  for (let i = 0; i < entries.length; i++) {
    const member = guild.members.cache.get(entries[i].id);
    const name = member ? member.user.username : entries[i].id;

    text += `${i + 1}. **${name}** — ${formatMoney(entries[i].value)}원\n`;
  }

  return text;
}

const elections = new Map();

function getElection(guildId) {
  return elections.get(guildId);
}

const commands = [
  new SlashCommandBuilder()
    .setName("선거시작")
    .setDescription("선거를 시작합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("후보를 등록합니다.")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("후보 이름")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
    .setDescription("선거를 종료합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("결과")
    .setDescription("선거 결과를 봅니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("주식참여")
    .setDescription("주식 시스템에 참여합니다."),

  new SlashCommandBuilder()
    .setName("주식목록")
    .setDescription("주식 목록을 봅니다."),

  new SlashCommandBuilder()
    .setName("주식메뉴")
    .setDescription("주식 거래소 메뉴를 만듭니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("주식을 매수합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("주식 이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세매수")
    .setDescription("면세돈으로 주식을 매수합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("주식 이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("매도")
    .setDescription("주식을 매도합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("주식 이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세매도")
    .setDescription("면세 주식을 매도합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("주식 이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("잔액")
    .setDescription("잔액을 확인합니다."),

  new SlashCommandBuilder()
    .setName("내주식")
    .setDescription("보유 주식을 확인합니다."),

  new SlashCommandBuilder()
    .setName("주식랭킹")
    .setDescription("주식 자산 랭킹을 확인합니다."),

  new SlashCommandBuilder()
    .setName("주식추가")
    .setDescription("주식을 추가합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("주식 이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("가격").setDescription("시작 가격").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("종류")
        .setDescription("소형 또는 대형")
        .setRequired(true)
        .addChoices(
          { name: "소형", value: "small" },
          { name: "대형", value: "large" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("주식삭제")
    .setDescription("주식을 삭제합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("주식 이름").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("주식가격")
    .setDescription("주가를 변경합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("주식 이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("가격").setDescription("새 가격").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("돈추가")
    .setDescription("돈을 추가합니다.")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("돈제거")
    .setDescription("돈을 제거합니다.")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("면세돈추가")
    .setDescription("면세돈을 추가합니다.")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("면세돈제거")
    .setDescription("면세돈을 제거합니다.")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("세금률설정")
    .setDescription("세율을 변경합니다.")
    .addIntegerOption(o =>
      o.setName("세율")
        .setDescription("0~100%")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("로그채널")
    .setDescription("로그 채널을 설정합니다.")
    .addChannelOption(o =>
      o.setName("채널")
        .setDescription("로그 채널")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("관리자메뉴")
    .setDescription("관리자 메뉴를 만듭니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

async function registerGuildCommands(guildId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guildId),
      { body: commands }
    );
  } catch (e) {
    console.error("명령어 등록 실패:", e);
  }
}

function adminButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_stock_add")
        .setLabel("주식 추가")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("admin_stock_delete")
        .setLabel("주식 삭제")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("admin_stock_price")
        .setLabel("주가 변경")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("admin_tax")
        .setLabel("세율 설정")
        .setStyle(ButtonStyle.Primary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_money_add")
        .setLabel("돈 추가")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("admin_money_remove")
        .setLabel("돈 제거")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("admin_taxfree_add")
        .setLabel("면세돈 추가")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("admin_taxfree_remove")
        .setLabel("면세돈 제거")
        .setStyle(ButtonStyle.Danger)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_election_start")
        .setLabel("선거 시작")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("admin_election_end")
        .setLabel("선거 종료")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("admin_election_result")
        .setLabel("선거 결과")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("admin_log")
        .setLabel("로그 채널")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function modalInput(id, label, placeholder, style = TextInputStyle.Short) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(style)
    .setRequired(true);
}

function makeModal(id, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(id)
    .setTitle(title);

  for (const input of inputs) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );
  }

  return modal;
}

async function handleAdminModal(interaction) {
  const id = interaction.customId;

  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "❌ 관리자만 사용할 수 있습니다.",
      ephemeral: true
    });
  }

  const value = x => interaction.fields.getTextInputValue(x);

  if (id === "admin_stock_add_modal") {
    const name = value("name");
    const price = Number(value("price"));
    const type = value("type").toLowerCase();

    if (!name || !Number.isInteger(price) || price <= 0) {
      return replyAndDelete(interaction, "❌ 입력값이 올바르지 않습니다.");
    }

    if (type !== "small" && type !== "large") {
      return replyAndDelete(interaction, "❌ 종류는 small 또는 large 입니다.");
    }

    if (data.stocks[name]) {
      return replyAndDelete(interaction, "❌ 이미 존재하는 주식입니다.");
    }

    const smallCount = Object.values(data.stocks)
      .filter(s => s.type === "small").length;

    if (type === "small" && smallCount >= MAX_SMALL_STOCKS) {
      return replyAndDelete(
        interaction,
        `❌ 소형 주식은 최대 ${MAX_SMALL_STOCKS}개입니다.`
      );
    }

    data.stocks[name] = { price, type };
    saveData();

    await sendLog(
      interaction.guildId,
      "➕ 주식 추가",
      `관리자: ${interaction.user}\n종목: **${name}**\n가격: **${formatMoney(price)}원**\n종류: **${stockTypeText(type)}**`
    );

    await replyAndDelete(interaction, `✅ ${name} 주식이 추가되었습니다.`);
    await updateAllStockMenus();
  }

  else if (id === "admin_stock_delete_modal") {
    const name = value("name");

    if (!data.stocks[name]) {
      return replyAndDelete(interaction, "❌ 존재하지 않는 주식입니다.");
    }

    for (const account of Object.values(data.users)) {
      if (
        Number(account.stocks?.[name] || 0) > 0 ||
        Number(account.taxFreeStocks?.[name] || 0) > 0
      ) {
        return replyAndDelete(
          interaction,
          "❌ 누군가 보유 중인 주식은 삭제할 수 없습니다."
        );
      }
    }

    delete data.stocks[name];
    saveData();

    await sendLog(
      interaction.guildId,
      "➖ 주식 삭제",
      `관리자: ${interaction.user}\n종목: **${name}**`
    );

    await replyAndDelete(interaction, `✅ ${name} 주식이 삭제되었습니다.`);
    await updateAllStockMenus();
  }

  else if (id === "admin_stock_price_modal") {
    const name = value("name");
    const price = Number(value("price"));

    if (!data.stocks[name]) {
      return replyAndDelete(interaction, "❌ 존재하지 않는 주식입니다.");
    }

    if (!Number.isInteger(price) || price <= 0) {
      return replyAndDelete(interaction, "❌ 가격이 올바르지 않습니다.");
    }

    const oldPrice = data.stocks[name].price;
    data.stocks[name].price = price;
    saveData();

    await sendLog(
      interaction.guildId,
      "💹 주가 변경",
      `관리자: ${interaction.user}\n종목: **${name}**\n기존: **${formatMoney(oldPrice)}원**\n변경: **${formatMoney(price)}원**`
    );

    await replyAndDelete(interaction, "✅ 주가가 변경되었습니다.");
    await updateAllStockMenus();
  }

  else if (id === "admin_tax_modal") {
    const rate = Number(value("rate"));

    if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
      return replyAndDelete(interaction, "❌ 세율은 0~100 사이여야 합니다.");
    }

    const settings = getGuild(interaction.guildId);
    const old = settings.taxRate;

    settings.taxRate = rate;
    saveData();

    await sendLog(
      interaction.guildId,
      "🧾 세율 변경",
      `관리자: ${interaction.user}\n기존 세율: **${old}%**\n새 세율: **${rate}%**`
    );

    await replyAndDelete(
      interaction,
      `✅ 세율이 **${rate}%**로 변경되었습니다.`
    );

    await updateAllStockMenus();
  }

  else if (
    id === "admin_money_add_modal" ||
    id === "admin_money_remove_modal" ||
    id === "admin_taxfree_add_modal" ||
    id === "admin_taxfree_remove_modal"
  ) {
    const userId = value("userId").replace(/[<@!>]/g, "");
    const amountText = value("amount");

    if (!/^\d+$/.test(userId) || !validAmount(amountText)) {
      return replyAndDelete(interaction, "❌ 사용자 ID 또는 금액이 올바르지 않습니다.");
    }

    const account = getAccount(userId);
    const amount = BigInt(amountText);

    let key;
    let title;

    if (id === "admin_money_add_modal") {
      key = "money";
      title = "💰 돈 추가";
      account.money = (BigInt(account.money) + amount).toString();
    }

    if (id === "admin_money_remove_modal") {
      key = "money";
      title = "💸 돈 제거";
      account.money = (
        BigInt(account.money) > amount
          ? BigInt(account.money) - amount
          : 0n
      ).toString();
    }

    if (id === "admin_taxfree_add_modal") {
      key = "taxFreeMoney";
      title = "🛡️ 면세돈 추가";
      account.taxFreeMoney =
        (BigInt(account.taxFreeMoney) + amount).toString();
    }

    if (id === "admin_taxfree_remove_modal") {
      key = "taxFreeMoney";
      title = "🛡️ 면세돈 제거";
      account.taxFreeMoney = (
        BigInt(account.taxFreeMoney) > amount
          ? BigInt(account.taxFreeMoney) - amount
          : 0n
      ).toString();
    }

    saveData();

    await sendLog(
      interaction.guildId,
      title,
      `관리자: ${interaction.user}\n대상: <@${userId}>\n금액: **${formatMoney(amount)}원**`
    );

    await replyAndDelete(interaction, "✅ 처리되었습니다.");
  }

  else if (id === "admin_log_modal") {
    const channelId = value("channelId").replace(/[<#>]/g, "");
    const channel = interaction.guild.channels.cache.get(channelId);

    if (!channel || !channel.isTextBased()) {
      return replyAndDelete(interaction, "❌ 올바른 채널 ID가 아닙니다.");
    }

    getGuild(interaction.guildId).logChannelId = channel.id;
    saveData();

    await replyAndDelete(
      interaction,
      `✅ 로그 채널이 ${channel}로 설정되었습니다.`
    );
  }
}

client.on("ready", async () => {
  console.log(`${client.user.tag} 로그인 완료`);

  for (const guild of client.guilds.cache.values()) {
    await registerGuildCommands(guild.id);
  }

  console.log("슬래시 명령어 등록 완료");
});

client.on("guildCreate", async guild => {
  await registerGuildCommands(guild.id);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isModalSubmit()) {
      return handleAdminModal(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("admin_") && !isAdmin(interaction)) {
        return interaction.reply({
          content: "❌ 관리자만 사용할 수 있습니다.",
          ephemeral: true
        });
      }

      if (interaction.customId === "buy_normal") {
        return interaction.showModal(
          makeModal(
            "buy_normal_modal",
            "일반돈으로 매수",
            [
              modalInput("stock", "주식 이름", "예: WB그룹"),
              modalInput("quantity", "수량", "예: 5")
            ]
          )
        );
      }

      if (interaction.customId === "buy_taxfree") {
        return interaction.showModal(
          makeModal(
            "buy_taxfree_modal",
            "면세돈으로 매수",
            [
              modalInput("stock", "주식 이름", "예: WB그룹"),
              modalInput("quantity", "수량", "예: 5")
            ]
          )
        );
      }

      if (interaction.customId === "sell_normal") {
        return interaction.showModal(
          makeModal(
            "sell_normal_modal",
            "주식 매도",
            [
              modalInput("stock", "주식 이름", "예: WB그룹"),
              modalInput("quantity", "수량", "예: 5")
            ]
          )
        );
      }

      if (interaction.customId === "sell_taxfree") {
        return interaction.showModal(
          makeModal(
            "sell_taxfree_modal",
            "면세 주식 매도",
            [
              modalInput("stock", "주식 이름", "예: WB그룹"),
              modalInput("quantity", "수량", "예: 5")
            ]
          )
        );
      }

      if (interaction.customId === "wallet") {
        return interaction.reply({
          content: walletText(interaction.user.id),
          ephemeral: true
        });
      }

      if (interaction.customId === "my_stocks") {
        return interaction.reply({
          content: holdingsText(interaction.user.id),
          ephemeral: true
        });
      }

      if (interaction.customId === "stock_list") {
        return interaction.reply({
          content: `📋 **주식 목록**\n\n${stockListText()}`,
          ephemeral: true
        });
      }

      if (interaction.customId === "stock_ranking") {
        return interaction.reply({
          content: await rankingText(interaction.guild),
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_stock_add") {
        return interaction.showModal(
          makeModal(
            "admin_stock_add_modal",
            "주식 추가",
            [
              modalInput("name", "주식 이름", "예: 새그룹"),
              modalInput("price", "가격", "예: 5000"),
              modalInput("type", "종류", "small 또는 large")
            ]
          )
        );
      }

      if (interaction.customId === "admin_stock_delete") {
        return interaction.showModal(
          makeModal(
            "admin_stock_delete_modal",
            "주식 삭제",
            [
              modalInput("name", "주식 이름", "예: 새그룹")
            ]
          )
        );
      }

      if (interaction.customId === "admin_stock_price") {
        return interaction.showModal(
          makeModal(
            "admin_stock_price_modal",
            "주가 변경",
            [
              modalInput("name", "주식 이름", "예: WB그룹"),
              modalInput("price", "새 가격", "예: 5000")
            ]
          )
        );
      }

      if (interaction.customId === "admin_tax") {
        return interaction.showModal(
          makeModal(
            "admin_tax_modal",
            "세율 설정",
            [
              modalInput("rate", "세율", "0~100")
            ]
          )
        );
      }

      if (interaction.customId === "admin_money_add") {
        return interaction.showModal(
          makeModal(
            "admin_money_add_modal",
            "돈 추가",
            [
              modalInput("userId", "사용자 ID", "예: 123456789"),
              modalInput("amount", "금액", "예: 100000")
            ]
          )
        );
      }

      if (interaction.customId === "admin_money_remove") {
        return interaction.showModal(
          makeModal(
            "admin_money_remove_modal",
            "돈 제거",
            [
              modalInput("userId", "사용자 ID", "예: 123456789"),
              modalInput("amount", "금액", "예: 100000")
            ]
          )
        );
      }

      if (interaction.customId === "admin_taxfree_add") {
        return interaction.showModal(
          makeModal(
            "admin_taxfree_add_modal",
            "면세돈 추가",
            [
              modalInput("userId", "사용자 ID", "예: 123456789"),
              modalInput("amount", "금액", "예: 100000")
            ]
          )
        );
      }

      if (interaction.customId === "admin_taxfree_remove") {
        return interaction.showModal(
          makeModal(
            "admin_taxfree_remove_modal",
            "면세돈 제거",
            [
              modalInput("userId", "사용자 ID", "예: 123456789"),
              modalInput("amount", "금액", "예: 100000")
            ]
          )
        );
      }

      if (interaction.customId === "admin_log") {
        return interaction.showModal(
          makeModal(
            "admin_log_modal",
            "로그 채널 설정",
            [
              modalInput("channelId", "채널 ID", "예: 123456789")
            ]
          )
        );
      }

      if (interaction.customId === "admin_election_start") {
        elections.set(interaction.guildId, {
          active: true,
          candidates: {},
          votes: {}
        });

        await sendLog(
          interaction.guildId,
          "🗳️ 선거 시작",
          `관리자: ${interaction.user}`
        );

        return replyAndDelete(interaction, "✅ 선거가 시작되었습니다.");
      }

      if (interaction.customId === "admin_election_end") {
        const election = getElection(interaction.guildId);

        if (!election || !election.active) {
          return replyAndDelete(interaction, "❌ 진행 중인 선거가 없습니다.");
        }

        election.active = false;

        await sendLog(
          interaction.guildId,
          "🛑 선거 종료",
          `관리자: ${interaction.user}`
        );

        return replyAndDelete(interaction, "✅ 선거가 종료되었습니다.");
      }

      if (interaction.customId === "admin_election_result") {
        const election = getElection(interaction.guildId);

        if (!election) {
          return replyAndDelete(interaction, "❌ 선거가 없습니다.");
        }

        const results = Object.entries(election.candidates)
          .sort((a, b) => b[1] - a[1])
          .map(([name, votes], i) =>
            `${i + 1}. **${name}** — ${votes}표`
          )
          .join("\n");

        const result = results || "후보가 없습니다.";

        await sendLog(
          interaction.guildId,
          "📊 선거 결과 조회",
          `관리자: ${interaction.user}`
        );

        return replyAndDelete(
          interaction,
          `📊 **선거 결과**\n\n${result}`
        );
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "buy_normal_modal") {
        return tradeBuy(
          interaction,
          interaction.fields.getTextInputValue("stock"),
          interaction.fields.getTextInputValue("quantity"),
          false
        );
      }

      if (interaction.customId === "buy_taxfree_modal") {
        return tradeBuy(
          interaction,
          interaction.fields.getTextInputValue("stock"),
          interaction.fields.getTextInputValue("quantity"),
          true
        );
      }

      if (interaction.customId === "sell_normal_modal") {
        return tradeSell(
          interaction,
          interaction.fields.getTextInputValue("stock"),
          interaction.fields.getTextInputValue("quantity"),
          false
        );
      }

      if (interaction.customId === "sell_taxfree_modal") {
        return tradeSell(
          interaction,
          interaction.fields.getTextInputValue("stock"),
          interaction.fields.getTextInputValue("quantity"),
          true
        );
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    if (
      [
        "선거시작",
        "후보등록",
        "선거종료",
        "결과",
        "주식메뉴",
        "주식추가",
        "주식삭제",
        "주식가격",
        "돈추가",
        "돈제거",
        "면세돈추가",
        "면세돈제거",
        "세금률설정",
        "로그채널",
        "관리자메뉴"
      ].includes(name) &&
      !isAdmin(interaction)
    ) {
      return replyAndDelete(interaction, "❌ 관리자만 사용할 수 있습니다.");
    }

    if (name === "선거시작") {
      elections.set(interaction.guildId, {
        active: true,
        candidates: {},
        votes: {}
      });

      await sendLog(
        interaction.guildId,
        "🗳️ 선거 시작",
        `관리자: ${interaction.user}`
      );

      return replyAndDelete(interaction, "✅ 선거가 시작되었습니다.");
    }

    if (name === "후보등록") {
      const election = getElection(interaction.guildId);
      const candidate = interaction.options.getString("이름");

      if (!election || !election.active) {
        return replyAndDelete(interaction, "❌ 진행 중인 선거가 없습니다.");
      }

      if (Object.keys(election.candidates).length >= 20) {
        return replyAndDelete(interaction, "❌ 후보는 최대 20명까지 등록할 수 있습니다.");
      }

      if (election.candidates[candidate] !== undefined) {
        return replyAndDelete(interaction, "❌ 이미 등록된 후보입니다.");
      }

      election.candidates[candidate] = 0;

      await sendLog(
        interaction.guildId,
        "📝 후보 등록",
        `관리자: ${interaction.user}\n후보: **${candidate}**`
      );

      return replyAndDelete(
        interaction,
        `✅ **${candidate}** 후보가 등록되었습니다.`
      );
    }

    if (name === "투표") {
      const election = getElection(interaction.guildId);
      const candidate = interaction.options.getString("후보");

      if (!election || !election.active) {
        return replyAndDelete(interaction, "❌ 현재 진행 중인 선거가 없습니다.");
      }

      if (election.candidates[candidate] === undefined) {
        return replyAndDelete(interaction, "❌ 존재하지 않는 후보입니다.");
      }

      if (election.votes[interaction.user.id]) {
        return replyAndDelete(interaction, "❌ 이미 투표했습니다.");
      }

      election.votes[interaction.user.id] = candidate;
      election.candidates[candidate]++;

      await sendLog(
        interaction.guildId,
        "🗳️ 투표",
        `사용자: ${interaction.user}\n후보: **${candidate}**`
      );

      return replyAndDelete(
        interaction,
        `✅ **${candidate}** 후보에게 투표했습니다.`
      );
    }

    if (name === "선거종료") {
      const election = getElection(interaction.guildId);

      if (!election || !election.active) {
        return replyAndDelete(interaction, "❌ 진행 중인 선거가 없습니다.");
      }

      election.active = false;

      await sendLog(
        interaction.guildId,
        "🛑 선거 종료",
        `관리자: ${interaction.user}`
      );

      return replyAndDelete(interaction, "✅ 선거가 종료되었습니다.");
    }

    if (name === "결과") {
      const election = getElection(interaction.guildId);

      if (!election) {
        return replyAndDelete(interaction, "❌ 선거 데이터가 없습니다.");
      }

      const results = Object.entries(election.candidates)
        .sort((a, b) => b[1] - a[1])
        .map(([candidate, votes], i) =>
          `${i + 1}. **${candidate}** — ${votes}표`
        )
        .join("\n");

      await sendLog(
        interaction.guildId,
        "📊 선거 결과",
        `관리자: ${interaction.user}`
      );

      return replyAndDelete(
        interaction,
        `📊 **선거 결과**\n\n${results || "결과가 없습니다."}`
      );
    }

    if (name === "주식참여") {
      getAccount(interaction.user.id);
      saveData();

      return interaction.reply({
        content: "✅ 주식 시스템 참여가 완료되었습니다.",
        ephemeral: true
      });
    }

    if (name === "주식목록") {
      return interaction.reply({
        content: `📋 **주식 목록**\n\n${stockListText()}`,
        ephemeral: true
      });
    }

    if (name === "주식메뉴") {
      await createStockMenu(interaction);

      return replyAndDelete(
        interaction,
        "✅ 주식 거래소 메뉴가 생성되었습니다."
      );
    }

    if (name === "매수") {
      return tradeBuy(
        interaction,
        interaction.options.getString("종목"),
        interaction.options.getInteger("수량"),
        false
      );
    }

    if (name === "면세매수") {
      return tradeBuy(
        interaction,
        interaction.options.getString("종목"),
        interaction.options.getInteger("수량"),
        true
      );
    }

    if (name === "매도") {
      return tradeSell(
        interaction,
        interaction.options.getString("종목"),
        interaction.options.getInteger("수량"),
        false
      );
    }

    if (name === "면세매도") {
      return tradeSell(
        interaction,
        interaction.options.getString("종목"),
        interaction.options.getInteger("수량"),
        true
      );
    }

    if (name === "잔액") {
      return interaction.reply({
        content: walletText(interaction.user.id),
        ephemeral: true
      });
    }

    if (name === "내주식") {
      return interaction.reply({
        content: holdingsText(interaction.user.id),
        ephemeral: true
      });
    }

    if (name === "주식랭킹") {
      return interaction.reply({
        content: await rankingText(interaction.guild),
        ephemeral: true
      });
    }

    if (name === "주식추가") {
      const stockName = interaction.options.getString("이름");
      const price = interaction.options.getInteger("가격");
      const type = interaction.options.getString("종류");

      if (data.stocks[stockName]) {
        return replyAndDelete(interaction, "❌ 이미 존재하는 주식입니다.");
      }

      const smallCount = Object.values(data.stocks)
        .filter(s => s.type === "small").length;

      if (type === "small" && smallCount >= MAX_SMALL_STOCKS) {
        return replyAndDelete(
          interaction,
          `❌ 소형 주식은 최대 ${MAX_SMALL_STOCKS}개입니다.`
        );
      }

      data.stocks[stockName] = {
        price,
        type
      };

      saveData();

      await sendLog(
        interaction.guildId,
        "➕ 주식 추가",
        `관리자: ${interaction.user}\n종목: **${stockName}**\n가격: **${formatMoney(price)}원**\n종류: **${stockTypeText(type)}**`
      );

      await replyAndDelete(interaction, "✅ 주식이 추가되었습니다.");
      return updateAllStockMenus();
    }

    if (name === "주식삭제") {
      const stockName = interaction.options.getString("이름");

      if (!data.stocks[stockName]) {
        return replyAndDelete(interaction, "❌ 존재하지 않는 주식입니다.");
      }

      for (const account of Object.values(data.users)) {
        if (
          Number(account.stocks?.[stockName] || 0) > 0 ||
          Number(account.taxFreeStocks?.[stockName] || 0) > 0
        ) {
          return replyAndDelete(
            interaction,
            "❌ 누군가 보유 중인 주식은 삭제할 수 없습니다."
          );
        }
      }

      delete data.stocks[stockName];
      saveData();

      await sendLog(
        interaction.guildId,
        "➖ 주식 삭제",
        `관리자: ${interaction.user}\n종목: **${stockName}**`
      );

      await replyAndDelete(interaction, "✅ 주식이 삭제되었습니다.");
      return updateAllStockMenus();
    }

    if (name === "주식가격") {
      const stockName = interaction.options.getString("이름");
      const price = interaction.options.getInteger("가격");

      if (!data.stocks[stockName]) {
        return replyAndDelete(interaction, "❌ 존재하지 않는 주식입니다.");
      }

      const oldPrice = data.stocks[stockName].price;
      data.stocks[stockName].price = price;

      saveData();

      await sendLog(
        interaction.guildId,
        "💹 주가 변경",
        `관리자: ${interaction.user}\n종목: **${stockName}**\n기존: **${formatMoney(oldPrice)}원**\n변경: **${formatMoney(price)}원**`
      );

      await replyAndDelete(interaction, "✅ 주가가 변경되었습니다.");
      return updateAllStockMenus();
    }

    if (
      name === "돈추가" ||
      name === "돈제거" ||
      name === "면세돈추가" ||
      name === "면세돈제거"
    ) {
      const user = interaction.options.getUser("사용자");
      const amountText = interaction.options.getString("금액");

      if (!validAmount(amountText)) {
        return replyAndDelete(interaction, "❌ 금액이 올바르지 않습니다.");
      }

      const amount = BigInt(amountText);
      const account = getAccount(user.id);

      let title;
      let key;

      if (name === "돈추가") {
        title = "💰 돈 추가";
        key = "money";
        account.money = (BigInt(account.money) + amount).toString();
      }

      if (name === "돈제거") {
        title = "💸 돈 제거";
        key = "money";
        account.money = (
          BigInt(account.money) > amount
            ? BigInt(account.money) - amount
            : 0n
        ).toString();
      }

      if (name === "면세돈추가") {
        title = "🛡️ 면세돈 추가";
        key = "taxFreeMoney";
        account.taxFreeMoney =
          (BigInt(account.taxFreeMoney) + amount).toString();
      }

      if (name === "면세돈제거") {
        title = "🛡️ 면세돈 제거";
        key = "taxFreeMoney";
        account.taxFreeMoney = (
          BigInt(account.taxFreeMoney) > amount
            ? BigInt(account.taxFreeMoney) - amount
            : 0n
        ).toString();
      }

      saveData();

      await sendLog(
        interaction.guildId,
        title,
        `관리자: ${interaction.user}\n대상: ${user}\n금액: **${formatMoney(amount)}원**`
      );

      return replyAndDelete(interaction, "✅ 처리되었습니다.");
    }

    if (name === "세금률설정") {
      const rate = interaction.options.getInteger("세율");
      const settings = getGuild(interaction.guildId);
      const old = settings.taxRate;

      settings.taxRate = rate;
      saveData();

      await sendLog(
        interaction.guildId,
        "🧾 세율 변경",
        `관리자: ${interaction.user}\n기존: **${old}%**\n변경: **${rate}%**`
      );

      await replyAndDelete(
        interaction,
        `✅ 세율이 **${rate}%**로 변경되었습니다.`
      );

      return updateAllStockMenus();
    }

    if (name === "로그채널") {
      const channel = interaction.options.getChannel("채널");

      if (!channel.isTextBased()) {
        return replyAndDelete(interaction, "❌ 텍스트 채널만 가능합니다.");
      }

      getGuild(interaction.guildId).logChannelId = channel.id;
      saveData();

      return replyAndDelete(
        interaction,
        `✅ 로그 채널이 ${channel}로 설정되었습니다.`
      );
    }

    if (name === "관리자메뉴") {
      const embed = new EmbedBuilder()
        .setTitle("👑 관리자 메뉴")
        .setDescription(
          "아래 버튼으로 주식·돈·세율·선거·로그를 관리하세요."
        );

      await interaction.channel.send({
        embeds: [embed],
        components: adminButtons()
      });

      return replyAndDelete(interaction, "✅ 관리자 메뉴를 생성했습니다.");
    }
  } catch (e) {
    console.error("interaction 오류:", e);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ 처리 중 오류가 발생했습니다.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

/* 5분마다 주가 변동 */
setInterval(async () => {
  let changed = false;

  for (const [name, stock] of Object.entries(data.stocks)) {
    const oldPrice = Number(stock.price);

    const percent =
      Math.floor(Math.random() * 11) - 5;

    const newPrice = Math.max(
      1,
      Math.round(oldPrice * (100 + percent) / 100)
    );

    if (newPrice !== oldPrice) {
      stock.price = newPrice;
      changed = true;

      for (const guild of client.guilds.cache.values()) {
        await sendLog(
          guild.id,
          "📈 주가 자동 변동",
          `종목: **${name}**\n기존 가격: **${formatMoney(oldPrice)}원**\n현재 가격: **${formatMoney(newPrice)}원**\n변동: **${percent}%**`
        );
      }
    }
  }

  if (changed) {
    saveData();
    await updateAllStockMenus();
  }
}, 5 * 60 * 1000);

/* 서버 상태 확인용 */
const app = express();

app.get("/", (req, res) => {
  res.send("Discord Election & Stock Bot is running.");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`웹 서버 실행: ${PORT}`);
});

client.login(TOKEN);
