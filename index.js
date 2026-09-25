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
  TextInputStyle,
  ChannelType
} = require("discord.js");

const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATA_FILE = "./stock-data.json";

if (!TOKEN || !CLIENT_ID) {
  console.error("DISCORD_TOKEN 또는 CLIENT_ID 환경변수가 없습니다.");
  process.exit(1);
}

/* =========================
   기본 설정
========================= */

const SMALL_MIN = 2000;
const LARGE_MIN = 10000;

const SMALL_MAX = 20;
const LARGE_MAX = 50;

const MAX_SMALL_STOCKS = 20;

const DEFAULT_TAX_RATE = 20;

const SAVINGS_RATES = {
  1: 2.1,
  3: 3.0
};

const SAVINGS_TAX = 15.4;
const EARLY_CANCEL_RATE = 1.0;

/* =========================
   Discord Client
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

/* =========================
   데이터
========================= */

let data = {
  guilds: {}
};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );
  } catch {
    data = {
      guilds: {}
    };
  }
}

if (!data.guilds) {
  data.guilds = {};
}

/* =========================
   저장
========================= */

function save() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

/* =========================
   서버 데이터
========================= */

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      users: {},

      stocks: {
        "WB그룹": {
          price: 2000,
          type: "small",
          chairmanUserId: null
        },

        "유마그룹": {
          price: 3000,
          type: "small",
          chairmanUserId: null
        }
      },

      taxRate: DEFAULT_TAX_RATE,

      inflation: 0,
      inflationLimit: 20,
      economyPaused: false,

      inflationEmergencySnapshot: null,

      economyAdminRoleId: null,

      logChannelId: null,

      stockMenuChannelId: null,
      stockMenuMessageId: null,

      bankMenuChannelId: null,
      bankMenuMessageId: null
    };

    save();
  }

  const guildData = data.guilds[guildId];

  if (!guildData.users) {
    guildData.users = {};
  }

  if (!guildData.stocks) {
    guildData.stocks = {};
  }

  if (typeof guildData.taxRate !== "number") {
    guildData.taxRate = DEFAULT_TAX_RATE;
  }

  if (typeof guildData.inflation !== "number") {
    guildData.inflation = 0;
  }

  if (typeof guildData.inflationLimit !== "number") {
    guildData.inflationLimit = 20;
  }

  if (typeof guildData.economyPaused !== "boolean") {
    guildData.economyPaused = false;
  }

  if (
    guildData.inflationEmergencySnapshot === undefined
  ) {
    guildData.inflationEmergencySnapshot = null;
  }

  if (guildData.economyAdminRoleId === undefined) {
    guildData.economyAdminRoleId = null;
  }

  if (guildData.logChannelId === undefined) {
    guildData.logChannelId = null;
  }

  if (!guildData.stocks["WB그룹"]) {
    guildData.stocks["WB그룹"] = {
      price: 2000,
      type: "small",
      chairmanUserId: null
    };
  }

  if (!guildData.stocks["유마그룹"]) {
    guildData.stocks["유마그룹"] = {
      price: 3000,
      type: "small",
      chairmanUserId: null
    };
  }

  for (const stock of Object.values(guildData.stocks)) {
    if (stock.chairmanUserId === undefined) {
      stock.chairmanUserId = null;
    }
  }

  return guildData;
}

/* =========================
   유저 데이터
========================= */

function getUser(guildId, userId) {
  const guildData = getGuild(guildId);

  if (!guildData.users[userId]) {
    guildData.users[userId] = {
      money: "0",
      taxFreeMoney: "0",
      bank: "0",
      stocks: {},
      savings: []
    };
  }

  const user = guildData.users[userId];

  if (!user.stocks) {
    user.stocks = {};
  }

  if (!Array.isArray(user.savings)) {
    user.savings = [];
  }

  if (user.money == null) {
    user.money = "0";
  }

  if (user.taxFreeMoney == null) {
    user.taxFreeMoney = "0";
  }

  if (user.bank == null) {
    user.bank = "0";
  }

  return user;
}

/* =========================
   금액 처리
========================= */

function big(value) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function money(value) {
  return (
    big(value).toLocaleString("ko-KR") +
    "원"
  );
}

function cleanAmount(value) {
  const amount = big(value);

  return amount < 0n
    ? -amount
    : amount;
}

/* =========================
   관리자 확인
========================= */

function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions &&
    interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    )
  );
}

/* =========================
   경제 정지 확인
========================= */

function isPaused(guildData) {
  return guildData.economyPaused === true;
}

/* =========================
   10초 후 메시지 삭제
========================= */

async function reply10(interaction, content) {
  await interaction.reply({
    content,
    ephemeral: false
  });

  setTimeout(async () => {
    try {
      await interaction.deleteReply();
    } catch {}
  }, 10000);
}

/* =========================
   로그
========================= */

async function log(
  guildId,
  title,
  description
) {
  const guildData = getGuild(guildId);

  if (!guildData.logChannelId) {
    return;
  }

  const guild =
    client.guilds.cache.get(guildId);

  if (!guild) {
    return;
  }

  const channel =
    guild.channels.cache.get(
      guildData.logChannelId
    );

  if (!channel || !channel.isTextBased()) {
    return;
  }

  try {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setTimestamp()
      ]
    });
  } catch {}
}

/* =========================
   선거
   재시작하면 초기화
========================= */

const elections = new Map();

function getElection(guildId) {
  if (!elections.has(guildId)) {
    elections.set(guildId, {
      active: false,
      candidates: [],
      votes: {},
      candidateListChannelId: null,
      candidateListMessageId: null
    });
  }

  return elections.get(guildId);
}

function electionText(election) {
  if (!election.candidates.length) {
    return "등록된 후보가 없습니다.";
  }

  return election.candidates
    .map(
      (name, index) =>
        `${index + 1}. ${name}`
    )
    .join("\n");
}

async function updateCandidateList(guildId) {
  const election =
    getElection(guildId);

  if (
    !election.candidateListChannelId ||
    !election.candidateListMessageId
  ) {
    return;
  }

  const guild =
    client.guilds.cache.get(guildId);

  if (!guild) {
    return;
  }

  const channel =
    guild.channels.cache.get(
      election.candidateListChannelId
    );

  if (!channel || !channel.isTextBased()) {
    return;
  }

  try {
    const message =
      await channel.messages.fetch(
        election.candidateListMessageId
      );

    await message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗳️ 후보 목록")
          .setDescription(
            electionText(election)
          )
          .setTimestamp()
      ]
    });
  } catch {}
}

/* =========================
   주식 기본 함수
========================= */

function userShares(
  user,
  stockName
) {
  return Number(
    user.stocks?.[stockName] || 0
  );
}

function totalShares(
  guildData,
  stockName
) {
  let total = 0;

  for (
    const user
    of Object.values(guildData.users)
  ) {
    total += userShares(
      user,
      stockName
    );
  }

  return total;
}

function stockValue(
  guildData,
  user
) {
  let total = 0n;

  for (
    const [name, quantity]
    of Object.entries(user.stocks || {})
  ) {
    const stock =
      guildData.stocks[name];

    if (!stock) {
      continue;
    }

    total +=
      BigInt(
        Math.max(
          0,
          Math.round(stock.price)
        )
      ) *
      BigInt(quantity);
  }

  return total;
}

function sharePercent(
  guildData,
  user,
  stockName
) {
  const total =
    totalShares(
      guildData,
      stockName
    );

  if (total <= 0) {
    return 0;
  }

  return (
    userShares(
      user,
      stockName
    ) /
    total
  ) * 100;
}

/* =========================
   주식 메뉴
========================= */

function stockMenuEmbed(
  guildData
) {
  let text = "";

  const entries =
    Object.entries(
      guildData.stocks
    );

  if (!entries.length) {
    text =
      "현재 등록된 주식이 없습니다.";
  } else {
    for (
      const [name, stock]
      of entries
    ) {
      text +=
`**${name}**
현재가: ${Math.round(stock.price).toLocaleString("ko-KR")}원
종류: ${stock.type === "small" ? "소형" : "대형"}
전체 보유량: ${totalShares(guildData, name)}주

`;
    }
  }

  return new EmbedBuilder()
    .setTitle("📈 주식 거래소")
    .setDescription(
`${text}
━━━━━━━━━━━━━━
🧾 거래 세율: ${guildData.taxRate}%
📊 인플레이션: ${guildData.inflation}%

${guildData.economyPaused
  ? "🚨 경제 비상정지"
  : "🟢 거래 가능"}

※ 주식 가격은 평일 KRX 장중 시간대에 자동 변동합니다.
`
    )
    .setTimestamp();
}

function stockMenuRows() {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("stock_buy")
          .setLabel("💵 일반 매수")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "stock_taxfree_buy"
          )
          .setLabel("🛡️ 면세 매수")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId("stock_sell")
          .setLabel("💸 일반 매도")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "stock_taxfree_sell"
          )
          .setLabel("🛡️ 면세 매도")
          .setStyle(
            ButtonStyle.Secondary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("wallet")
          .setLabel("👛 내 지갑")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("my_stocks")
          .setLabel("📦 내 주식")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("stock_list")
          .setLabel("📋 주식 목록")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("stock_rank")
          .setLabel("🏆 주식 랭킹")
          .setStyle(
            ButtonStyle.Secondary
          )
      )
  ];
}

async function updateStockMenu(
  guildId
) {
  const guildData =
    getGuild(guildId);

  if (
    !guildData.stockMenuChannelId ||
    !guildData.stockMenuMessageId
  ) {
    return;
  }

  const guild =
    client.guilds.cache.get(guildId);

  if (!guild) {
    return;
  }

  const channel =
    guild.channels.cache.get(
      guildData.stockMenuChannelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  try {
    const message =
      await channel.messages.fetch(
        guildData.stockMenuMessageId
      );

    await message.edit({
      embeds: [
        stockMenuEmbed(guildData)
      ],
      components:
        stockMenuRows()
    });
  } catch {}
} 
/* =========================
   은행 / 적금
========================= */

function savingsMaturityDate(
  startTime,
  months
) {
  const date = new Date(startTime);

  date.setMonth(
    date.getMonth() + months
  );

  return date;
}

function savingsRate(months) {
  return SAVINGS_RATES[months] || 0;
}

function savingsInterest(
  principal,
  months
) {
  const rate =
    savingsRate(months);

  return (
    big(principal) *
    BigInt(
      Math.round(rate * 100)
    ) /
    10000n
  );
}

function savingsTax(
  interest
) {
  return (
    big(interest) *
    154n /
    1000n
  );
}

function availableSavings(
  user
) {
  return user.savings.filter(
    s => !s.matured
  );
}

/* =========================
   인플레이션
========================= */

function totalAssets(
  guildData,
  user
) {
  return (
    big(user.money) +
    big(user.taxFreeMoney) +
    big(user.bank) +
    stockValue(
      guildData,
      user
    )
  );
}

function makeInflationSnapshot(
  guildData
) {
  const users = {};

  for (
    const [userId, user]
    of Object.entries(
      guildData.users
    )
  ) {
    let savingsPrincipal = 0n;

    for (
      const saving
      of user.savings || []
    ) {
      if (!saving.matured) {
        savingsPrincipal +=
          big(saving.principal);
      }
    }

    users[userId] = {
      cash: String(
        big(user.money)
      ),
      taxFree: String(
        big(user.taxFreeMoney)
      ),
      bank: String(
        big(user.bank)
      ),
      savings: String(
        savingsPrincipal
      ),
      stockValue: String(
        stockValue(
          guildData,
          user
        )
      ),
      totalAssets: String(
        totalAssets(
          guildData,
          user
        )
      )
    };
  }

  return users;
}

/* =========================
   인플레이션 비상정지
========================= */

async function triggerEconomyPause(
  guildId
) {
  const guildData =
    getGuild(guildId);

  if (
    guildData.economyPaused
  ) {
    return;
  }

  guildData.economyPaused = true;

  guildData.inflationEmergencySnapshot =
    makeInflationSnapshot(
      guildData
    );

  let removedShares = 0;

  for (
    const stockName
    of Object.keys(
      guildData.stocks
    )
  ) {
    for (
      const user
      of Object.values(
        guildData.users
      )
    ) {
      const current =
        userShares(
          user,
          stockName
        );

      if (current <= 0) {
        continue;
      }

      user.stocks[stockName] =
        current - 1;

      removedShares++;
    }
  }

  save();

  await updateStockMenu(
    guildId
  );

  const roleId =
    guildData.economyAdminRoleId;

  const mention =
    roleId
      ? `<@&${roleId}>`
      : "";

  await log(
    guildId,
    "🚨 경제 비상정지",
`인플레이션: **${guildData.inflation}%**
기준: **${guildData.inflationLimit}%**

인플레이션 기준에 도달하여 경제 거래가 정지되었습니다.

자동 지분 제거:
**${removedShares}주**

${mention}`
  );
}

async function checkInflation(
  guildId
) {
  const guildData =
    getGuild(guildId);

  if (
    guildData.inflation >=
      guildData.inflationLimit &&
    !guildData.economyPaused
  ) {
    await triggerEconomyPause(
      guildId
    );
  }
}

/* =========================
   KRX 장 운영시간
========================= */

function isKrxOpen() {
  const now = new Date();

  const koreaTime =
    new Date(
      now.toLocaleString(
        "en-US",
        {
          timeZone:
            "Asia/Seoul"
        }
      )
    );

  const day =
    koreaTime.getDay();

  if (
    day === 0 ||
    day === 6
  ) {
    return false;
  }

  const hour =
    koreaTime.getHours();

  const minute =
    koreaTime.getMinutes();

  const current =
    hour * 60 + minute;

  const open =
    9 * 60;

  const close =
    15 * 60 + 30;

  return (
    current >= open &&
    current <= close
  );
}

/* =========================
   주식 자동 가격 변동
========================= */

async function moveStockPrices() {
  for (
    const [
      guildId,
      guildData
    ]
    of Object.entries(
      data.guilds
    )
  ) {
    if (!isKrxOpen()) {
      continue;
    }

    for (
      const [
        stockName,
        stock
      ]
      of Object.entries(
        guildData.stocks
      )
    ) {
      const oldPrice =
        Number(stock.price);

      if (
        !Number.isFinite(oldPrice) ||
        oldPrice <= 0
      ) {
        continue;
      }

      const change =
        (Math.random() * 10) - 5;

      let newPrice =
        oldPrice *
        (1 + change / 100);

      if (newPrice < 1) {
        newPrice = 1;
      }

      stock.price =
        Math.round(newPrice);

      await log(
        guildId,
        "📈 주식 가격 변동",
`${stockName}

이전 가격:
${oldPrice.toLocaleString("ko-KR")}원

변경 가격:
${stock.price.toLocaleString("ko-KR")}원

변동률:
${change.toFixed(2)}%`
      );
    }

    save();

    await updateStockMenu(
      guildId
    );
  }
}

/* =========================
   주식 거래 검증
========================= */

function getStock(
  guildData,
  name
) {
  return guildData.stocks[name];
}

function validateStockQuantity(
  stock,
  quantity
) {
  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return "수량은 1주 이상이어야 합니다.";
  }

  const max =
    stock.type === "small"
      ? SMALL_MAX
      : LARGE_MAX;

  if (quantity > max) {
    return `한 번에 최대 ${max}주까지 거래할 수 있습니다.`;
  }

  return null;
}

function stockMinimum(
  stock
) {
  return stock.type === "small"
    ? SMALL_MIN
    : LARGE_MIN;
}

/* =========================
   일반 주식 매수
========================= */

async function buyStock(
  interaction,
  stockName,
  quantity,
  taxFree
) {
  const guildId =
    interaction.guildId;

  const guildData =
    getGuild(guildId);

  const user =
    getUser(
      guildId,
      interaction.user.id
    );

  if (
    isPaused(guildData)
  ) {
    return reply10(
      interaction,
      "🚨 현재 경제가 비상정지 상태입니다."
    );
  }

  const stock =
    getStock(
      guildData,
      stockName
    );

  if (!stock) {
    return reply10(
      interaction,
      "존재하지 않는 주식입니다."
    );
  }

  const error =
    validateStockQuantity(
      stock,
      quantity
    );

  if (error) {
    return reply10(
      interaction,
      error
    );
  }

  const subtotal =
    BigInt(
      Math.round(
        stock.price
      )
    ) *
    BigInt(quantity);

  const tax =
    taxFree
      ? 0n
      : subtotal *
        BigInt(
          guildData.taxRate
        ) /
        100n;

  const total =
    subtotal + tax;

  if (
    taxFree &&
    big(user.taxFreeMoney) < total
  ) {
    return reply10(
      interaction,
      `면세금이 부족합니다.\n필요: ${money(total)}`
    );
  }

  if (
    !taxFree &&
    big(user.money) < total
  ) {
    return reply10(
      interaction,
      `일반 돈이 부족합니다.\n필요: ${money(total)}`
    );
  }

  if (taxFree) {
    user.taxFreeMoney =
      String(
        big(user.taxFreeMoney) -
        total
      );
  } else {
    user.money =
      String(
        big(user.money) -
        total
      );
  }

  user.stocks[stockName] =
    userShares(
      user,
      stockName
    ) + quantity;

  save();

  await updateStockMenu(
    guildId
  );

  await log(
    guildId,
    "📈 주식 매수",
`${interaction.user.tag}

주식:
${stockName}

수량:
${quantity}주

주문금액:
${money(subtotal)}

세금:
${money(tax)}

총액:
${money(total)}

종류:
${taxFree ? "면세금" : "일반금"}`
  );

  return reply10(
    interaction,
`✅ 매수 완료

${stockName}
${quantity}주

주문금액: ${money(subtotal)}
세금: ${money(tax)}
총액: ${money(total)}`
  );
}

/* =========================
   일반 주식 매도
========================= */

async function sellStock(
  interaction,
  stockName,
  quantity,
  taxFree
) {
  const guildId =
    interaction.guildId;

  const guildData =
    getGuild(guildId);

  const user =
    getUser(
      guildId,
      interaction.user.id
    );

  if (
    isPaused(guildData)
  ) {
    return reply10(
      interaction,
      "🚨 현재 경제가 비상정지 상태입니다."
    );
  }

  const stock =
    getStock(
      guildData,
      stockName
    );

  if (!stock) {
    return reply10(
      interaction,
      "존재하지 않는 주식입니다."
    );
  }

  const error =
    validateStockQuantity(
      stock,
      quantity
    );

  if (error) {
    return reply10(
      interaction,
      error
    );
  }

  const owned =
    userShares(
      user,
      stockName
    );

  if (owned < quantity) {
    return reply10(
      interaction,
      `보유 주식이 부족합니다.\n보유: ${owned}주`
    );
  }

  const subtotal =
    BigInt(
      Math.round(
        stock.price
      )
    ) *
    BigInt(quantity);

  const tax =
    taxFree
      ? 0n
      : subtotal *
        BigInt(
          guildData.taxRate
        ) /
        100n;

  const receive =
    subtotal - tax;

  user.stocks[stockName] =
    owned - quantity;

  if (
    user.stocks[stockName] <= 0
  ) {
    delete user.stocks[stockName];
  }

  if (taxFree) {
    user.taxFreeMoney =
      String(
        big(user.taxFreeMoney) +
        receive
      );
  } else {
    user.money =
      String(
        big(user.money) +
        receive
      );
  }

  save();

  await updateStockMenu(
    guildId
  );

  await log(
    guildId,
    "📉 주식 매도",
`${interaction.user.tag}

주식:
${stockName}

수량:
${quantity}주

매도금액:
${money(subtotal)}

세금:
${money(tax)}

실수령:
${money(receive)}

종류:
${taxFree ? "면세금" : "일반금"}`
  );

  return reply10(
    interaction,
`✅ 매도 완료

${stockName}
${quantity}주

매도금액: ${money(subtotal)}
세금: ${money(tax)}
실수령: ${money(receive)}`
  );
} 
/* =========================
   주식 양도
========================= */

async function transferStock(
  interaction,
  targetUser,
  stockName,
  quantity
) {
  const guildId =
    interaction.guildId;

  const guildData =
    getGuild(guildId);

  const user =
    getUser(
      guildId,
      interaction.user.id
    );

  const target =
    getUser(
      guildId,
      targetUser.id
    );

  if (
    isPaused(guildData)
  ) {
    return reply10(
      interaction,
      "🚨 현재 경제가 비상정지 상태입니다."
    );
  }

  const stock =
    guildData.stocks[stockName];

  if (!stock) {
    return reply10(
      interaction,
      "존재하지 않는 주식입니다."
    );
  }

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return reply10(
      interaction,
      "수량은 1주 이상이어야 합니다."
    );
  }

  const owned =
    userShares(
      user,
      stockName
    );

  if (owned < quantity) {
    return reply10(
      interaction,
      `보유 주식이 부족합니다.\n보유: ${owned}주`
    );
  }

  user.stocks[stockName] =
    owned - quantity;

  if (
    user.stocks[stockName] <= 0
  ) {
    delete user.stocks[stockName];
  }

  target.stocks[stockName] =
    userShares(
      target,
      stockName
    ) + quantity;

  save();

  await updateStockMenu(
    guildId
  );

  await log(
    guildId,
    "🔄 주식 양도",
`${interaction.user.tag}
→ ${targetUser.tag}

주식:
${stockName}

수량:
${quantity}주`
  );

  return reply10(
    interaction,
`✅ 주식 양도 완료

대상: <@${targetUser.id}>
주식: ${stockName}
수량: ${quantity}주`
  );
}

/* =========================
   회장 지정
========================= */

async function setChairman(
  interaction,
  stockName,
  user
) {
  const guildId =
    interaction.guildId;

  const guildData =
    getGuild(guildId);

  if (!isAdmin(interaction)) {
    return reply10(
      interaction,
      "❌ 서버 관리자만 회장을 지정할 수 있습니다."
    );
  }

  const stock =
    guildData.stocks[stockName];

  if (!stock) {
    return reply10(
      interaction,
      "존재하지 않는 주식입니다."
    );
  }

  stock.chairmanUserId =
    user.id;

  save();

  await log(
    guildId,
    "👔 회장 지정",
`${stockName}
회장: ${user.tag}`
  );

  return reply10(
    interaction,
`✅ 회장 지정 완료

회사: ${stockName}
회장: <@${user.id}>`
  );
}

/* =========================
   지분 추가
   - 서버 관리자
   - 해당 회사 회장
========================= */

async function addShares(
  interaction,
  targetUser,
  stockName,
  quantity
) {
  const guildId =
    interaction.guildId;

  const guildData =
    getGuild(guildId);

  const stock =
    guildData.stocks[stockName];

  if (!stock) {
    return reply10(
      interaction,
      "존재하지 않는 주식입니다."
    );
  }

  const chairman =
    stock.chairmanUserId;

  const allowed =
    isAdmin(interaction) ||
    chairman ===
      interaction.user.id;

  if (!allowed) {
    return reply10(
      interaction,
      "❌ 이 회사의 회장 또는 서버 관리자만 지분을 추가할 수 있습니다."
    );
  }

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return reply10(
      interaction,
      "수량은 1주 이상이어야 합니다."
    );
  }

  const user =
    getUser(
      guildId,
      targetUser.id
    );

  user.stocks[stockName] =
    userShares(
      user,
      stockName
    ) + quantity;

  save();

  await updateStockMenu(
    guildId
  );

  await log(
    guildId,
    "➕ 지분 추가",
`${interaction.user.tag}

대상:
${targetUser.tag}

회사:
${stockName}

추가:
${quantity}주`
  );

  return reply10(
    interaction,
`✅ 지분 추가 완료

대상: <@${targetUser.id}>
회사: ${stockName}
추가: ${quantity}주`
  );
}

/* =========================
   지분 제거
========================= */

async function removeShares(
  interaction,
  targetUser,
  stockName,
  quantity
) {
  const guildId =
    interaction.guildId;

  const guildData =
    getGuild(guildId);

  const stock =
    guildData.stocks[stockName];

  if (!stock) {
    return reply10(
      interaction,
      "존재하지 않는 주식입니다."
    );
  }

  const chairman =
    stock.chairmanUserId;

  const allowed =
    isAdmin(interaction) ||
    chairman ===
      interaction.user.id;

  if (!allowed) {
    return reply10(
      interaction,
      "❌ 이 회사의 회장 또는 서버 관리자만 지분을 제거할 수 있습니다."
    );
  }

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return reply10(
      interaction,
      "수량은 1주 이상이어야 합니다."
    );
  }

  const user =
    getUser(
      guildId,
      targetUser.id
    );

  const owned =
    userShares(
      user,
      stockName
    );

  if (owned < quantity) {
    return reply10(
      interaction,
      `대상의 보유 지분이 부족합니다.\n보유: ${owned}주`
    );
  }

  user.stocks[stockName] =
    owned - quantity;

  if (
    user.stocks[stockName] <= 0
  ) {
    delete user.stocks[stockName];
  }

  save();

  await updateStockMenu(
    guildId
  );

  await log(
    guildId,
    "➖ 지분 제거",
`${interaction.user.tag}

대상:
${targetUser.tag}

회사:
${stockName}

제거:
${quantity}주`
  );

  return reply10(
    interaction,
`✅ 지분 제거 완료

대상: <@${targetUser.id}>
회사: ${stockName}
제거: ${quantity}주`
  );
}

/* =========================
   명령어 생성
========================= */

function commands() {
  return [

    new SlashCommandBuilder()
      .setName("선거시작")
      .setDescription("선거를 시작합니다."),

    new SlashCommandBuilder()
      .setName("후보등록")
      .setDescription("선거 후보를 등록합니다.")
      .addStringOption(o =>
        o.setName("이름")
          .setDescription("후보 이름")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("투표")
      .setDescription("후보에게 투표합니다.")
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
      .setName("후보목록")
      .setDescription("후보 목록을 확인합니다."),

    new SlashCommandBuilder()
      .setName("돈추가")
      .setDescription("관리자가 돈을 추가합니다.")
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
      .setDescription("관리자가 돈을 제거합니다.")
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
      .setDescription("관리자가 면세금을 추가합니다.")
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
      .setDescription("관리자가 면세금을 제거합니다.")
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
      .setName("잔액")
      .setDescription("내 잔액을 확인합니다."),

    new SlashCommandBuilder()
      .setName("세금률설정")
      .setDescription("거래 세율을 설정합니다.")
      .addIntegerOption(o =>
        o.setName("세율")
          .setDescription("0~100")
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("주식참여")
      .setDescription("주식 거래에 참여합니다."),

    new SlashCommandBuilder()
      .setName("주식목록")
      .setDescription("주식 목록을 확인합니다."),

    new SlashCommandBuilder()
      .setName("매수")
      .setDescription("주식을 매수합니다.")
      .addStringOption(o =>
        o.setName("주식")
          .setDescription("주식 이름")
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
      .setDescription("주식을 매도합니다.")
      .addStringOption(o =>
        o.setName("주식")
          .setDescription("주식 이름")
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
      .setDescription("면세금으로 주식을 매수합니다.")
      .addStringOption(o =>
        o.setName("주식")
          .setDescription("주식 이름")
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
        o.setName("주식")
          .setDescription("주식 이름")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("수량")
          .setDescription("수량")
          .setMinValue(1)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("내주식")
      .setDescription("내 주식을 확인합니다."),

    new SlashCommandBuilder()
      .setName("주식랭킹")
      .setDescription("주식 보유 랭킹을 확인합니다."),

    new SlashCommandBuilder()
      .setName("주식메뉴")
      .setDescription("주식 메뉴를 생성합니다."),

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
          .setRequired(true)
          .addChoices(
            {
              name: "소형",
              value: "small"
            },
            {
              name: "대형",
              value: "large"
            }
          )
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
      ),

    new SlashCommandBuilder()
      .setName("주식양도")
      .setDescription("주식을 다른 사람에게 양도합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("받는 사람")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("주식")
          .setDescription("주식 이름")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("수량")
          .setDescription("수량")
          .setMinValue(1)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("지분양도")
      .setDescription("지분을 다른 사람에게 양도합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("받는 사람")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("주식")
          .setDescription("회사")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("수량")
          .setDescription("수량")
          .setMinValue(1)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("회장지정")
      .setDescription("회장을 지정합니다.")
      .addStringOption(o =>
        o.setName("회사")
          .setDescription("회사 이름")
          .setRequired(true)
      )
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("회장")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("지분추가")
      .setDescription("지분을 추가합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("대상")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("회사")
          .setDescription("회사")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("수량")
          .setDescription("수량")
          .setMinValue(1)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("지분제거")
      .setDescription("지분을 제거합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("대상")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("회사")
          .setDescription("회사")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("수량")
          .setDescription("수량")
          .setMinValue(1)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("은행")
      .setDescription("은행 메뉴를 표시합니다."),

    new SlashCommandBuilder()
      .setName("은행입금")
      .setDescription("은행에 입금합니다.")
      .addStringOption(o =>
        o.setName("금액")
          .setDescription("금액")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("은행출금")
      .setDescription("은행에서 출금합니다.")
      .addStringOption(o =>
        o.setName("금액")
          .setDescription("금액")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("송금")
      .setDescription("다른 사람에게 송금합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("받는 사람")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("금액")
          .setDescription("금액")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("적금가입")
      .setDescription("적금에 가입합니다.")
      .addStringOption(o =>
        o.setName("금액")
          .setDescription("가입 금액")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("기간")
          .setDescription("1개월 또는 3개월")
          .setRequired(true)
          .addChoices(
            {
              name: "1개월",
              value: 1
            },
            {
              name: "3개월",
              value: 3
            }
          )
      ),

    new SlashCommandBuilder()
      .setName("적금목록")
      .setDescription("내 적금을 확인합니다."),

    new SlashCommandBuilder()
      .setName("적금해지")
      .setDescription("적금을 중도해지합니다.")
      .addIntegerOption(o =>
        o.setName("번호")
          .setDescription("적금 번호")
          .setMinValue(1)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("적금만기")
      .setDescription("만기된 적금을 처리합니다."),

    new SlashCommandBuilder()
      .setName("인플레이션설정")
      .setDescription("인플레이션을 설정합니다.")
      .addIntegerOption(o =>
        o.setName("비율")
          .setDescription("0~100")
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("인플레이션기준설정")
      .setDescription("경제 비상정지 기준을 설정합니다.")
      .addIntegerOption(o =>
        o.setName("비율")
          .setDescription("0~100")
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("경제상태")
      .setDescription("경제 상태를 확인합니다."),

    new SlashCommandBuilder()
      .setName("경제정지해제")
      .setDescription("경제 비상정지를 해제합니다."),

    new SlashCommandBuilder()
      .setName("경제관리자역할")
      .setDescription("경제 관리자 역할을 지정합니다.")
      .addRoleOption(o =>
        o.setName("역할")
          .setDescription("경제 관리자 역할")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("로그채널")
      .setDescription("로그 채널을 설정합니다.")
      .addChannelOption(o =>
        o.setName("채널")
          .setDescription("로그 채널")
          .addChannelTypes(
            ChannelType.GuildText
          )
          .setRequired(true)
      )
  ];
} 
/* =========================
   Interaction 처리
========================= */

client.on("interactionCreate", async interaction => {
  try {

    /* =====================
       버튼
    ===================== */

    if (interaction.isButton()) {

      const guildId =
        interaction.guildId;

      if (!guildId) return;

      const guildData =
        getGuild(guildId);

      if (
        interaction.customId ===
        "stock_wallet"
      ) {
        const user =
          getUser(
            guildId,
            interaction.user.id
          );

        return interaction.reply({
          content:
`💰 지갑

현금: ${money(user.money)}
은행: ${money(user.bank)}
면세금: ${money(user.taxFree)}`,
          ephemeral: true
        });
      }

      if (
        interaction.customId ===
        "stock_list"
      ) {
        const names =
          Object.keys(
            guildData.stocks
          );

        if (!names.length) {
          return interaction.reply({
            content:
              "현재 등록된 주식이 없습니다.",
            ephemeral: true
          });
        }

        let text =
          "📈 **주식 목록**\n\n";

        for (const name of names) {
          const stock =
            guildData.stocks[name];

          text +=
`**${name}**
가격: ${stock.price.toLocaleString("ko-KR")}원
종류: ${
  stock.type === "large"
    ? "대형"
    : "소형"
}
회장: ${
  stock.chairmanUserId
    ? `<@${stock.chairmanUserId}>`
    : "미지정"
}

`;
        }

        return interaction.reply({
          content: text,
          ephemeral: true
        });
      }

      if (
        interaction.customId ===
        "stock_my"
      ) {
        const user =
          getUser(
            guildId,
            interaction.user.id
          );

        const names =
          Object.keys(
            user.stocks || {}
          );

        if (!names.length) {
          return interaction.reply({
            content:
              "보유한 주식이 없습니다.",
            ephemeral: true
          });
        }

        let text =
          "📊 **내 주식**\n\n";

        for (const name of names) {

          const quantity =
            userShares(
              user,
              name
            );

          const stock =
            guildData.stocks[name];

          if (!stock) continue;

          const value =
            quantity *
            Number(stock.price);

          const total =
            totalShares(
              guildData,
              name
            );

          const percent =
            total > 0
              ? (
                  quantity /
                  total *
                  100
                ).toFixed(2)
              : "0.00";

          text +=
`**${name}**
수량: ${quantity}주
평가액: ${value.toLocaleString("ko-KR")}원
지분율: ${percent}%

`;
        }

        return interaction.reply({
          content: text,
          ephemeral: true
        });
      }

      if (
        interaction.customId ===
        "stock_rank"
      ) {
        const users =
          Object.entries(
            guildData.users
          );

        const ranking =
          users
            .map(([id, u]) => {

              let value = 0;

              for (
                const name of
                Object.keys(
                  u.stocks || {}
                )
              ) {
                const stock =
                  guildData.stocks[name];

                if (!stock) continue;

                value +=
                  userShares(
                    u,
                    name
                  ) *
                  Number(
                    stock.price
                  );
              }

              return {
                id,
                value
              };
            })
            .sort(
              (a, b) =>
                b.value -
                a.value
            )
            .slice(0, 10);

        let text =
          "🏆 **주식 자산 랭킹**\n\n";

        if (!ranking.length) {
          text +=
            "아직 데이터가 없습니다.";
        }

        ranking.forEach(
          (item, index) => {
            text +=
`${index + 1}위 <@${item.id}> — ${item.value.toLocaleString("ko-KR")}원
`;
          }
        );

        return interaction.reply({
          content: text,
          ephemeral: true
        });
      }

      if (
        interaction.customId ===
        "stock_buy"
      ) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(
              "modal_stock_buy"
            )
            .setTitle(
              "일반돈 주식 매수"
            )
            .addComponents(
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "stock"
                    )
                    .setLabel(
                      "주식 이름"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                ),
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "quantity"
                    )
                    .setLabel(
                      "수량"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                )
            )
        );
      }

      if (
        interaction.customId ===
        "stock_taxfree_buy"
      ) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(
              "modal_stock_taxfree_buy"
            )
            .setTitle(
              "면세돈 주식 매수"
            )
            .addComponents(
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "stock"
                    )
                    .setLabel(
                      "주식 이름"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                ),
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "quantity"
                    )
                    .setLabel(
                      "수량"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                )
            )
        );
      }

      if (
        interaction.customId ===
        "stock_sell"
      ) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(
              "modal_stock_sell"
            )
            .setTitle(
              "일반돈 주식 매도"
            )
            .addComponents(
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "stock"
                    )
                    .setLabel(
                      "주식 이름"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                ),
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "quantity"
                    )
                    .setLabel(
                      "수량"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                )
            )
        );
      }

      if (
        interaction.customId ===
        "stock_taxfree_sell"
      ) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(
              "modal_stock_taxfree_sell"
            )
            .setTitle(
              "면세돈 주식 매도"
            )
            .addComponents(
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "stock"
                    )
                    .setLabel(
                      "주식 이름"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                ),
              new ActionRowBuilder()
                .addComponents(
                  new TextInputBuilder()
                    .setCustomId(
                      "quantity"
                    )
                    .setLabel(
                      "수량"
                    )
                    .setStyle(
                      TextInputStyle.Short
                    )
                    .setRequired(true)
                )
            )
        );
      }

      if (
        interaction.customId ===
        "bank_savings"
      ) {
        return interaction.reply({
          content:
`💰 적금

1개월: 2.1%
3개월: 3.0%

가입:
\`/적금가입\`

확인:
\`/적금목록\``,
          ephemeral: true
        });
      }
    }

    /* =====================
       모달
    ===================== */

    if (interaction.isModalSubmit()) {

      const guildId =
        interaction.guildId;

      if (!guildId) return;

      const stockName =
        interaction.fields.getTextInputValue(
          "stock"
        );

      const quantity =
        Number(
          interaction.fields.getTextInputValue(
            "quantity"
          )
        );

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return reply10(
          interaction,
          "수량이 올바르지 않습니다."
        );
      }

      if (
        interaction.customId ===
        "modal_stock_buy"
      ) {
        return buyStock(
          interaction,
          stockName,
          quantity,
          false
        );
      }

      if (
        interaction.customId ===
        "modal_stock_taxfree_buy"
      ) {
        return buyStock(
          interaction,
          stockName,
          quantity,
          true
        );
      }

      if (
        interaction.customId ===
        "modal_stock_sell"
      ) {
        return sellStock(
          interaction,
          stockName,
          quantity,
          false
        );
      }

      if (
        interaction.customId ===
        "modal_stock_taxfree_sell"
      ) {
        return sellStock(
          interaction,
          stockName,
          quantity,
          true
        );
      }
    }

    /* =====================
       슬래시 명령어
    ===================== */

    if (!interaction.isChatInputCommand())
      return;

    const guildId =
      interaction.guildId;

    if (!guildId) {
      return interaction.reply({
        content:
          "❌ 서버에서만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const guildData =
      getGuild(guildId);

    const command =
      interaction.commandName;

    /* =====================
       선거
    ===================== */

    if (
      command === "선거시작"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const election =
        getElection(guildId);

      if (election.active) {
        return reply10(
          interaction,
          "이미 진행 중인 선거가 있습니다."
        );
      }

      election.active =
        true;

      election.candidates = [];
      election.votes = {};
      election.votedUsers = new Set();

      await log(
        guildId,
        `🗳️ 선거 시작
${interaction.user.tag}`
      );

      return reply10(
        interaction,
        "🗳️ 선거가 시작되었습니다."
      );
    }

    if (
      command === "후보등록"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const election =
        getElection(guildId);

      if (!election.active) {
        return reply10(
          interaction,
          "진행 중인 선거가 없습니다."
        );
      }

      const name =
        interaction.options
          .getString("이름")
          .trim();

      if (!name) {
        return reply10(
          interaction,
          "후보 이름을 입력해주세요."
        );
      }

      if (
        election.candidates
          .some(
            x => x.name === name
          )
      ) {
        return reply10(
          interaction,
          "이미 등록된 후보입니다."
        );
      }

      if (
        election.candidates.length >=
        20
      ) {
        return reply10(
          interaction,
          "후보는 최대 20명까지 등록할 수 있습니다."
        );
      }

      election.candidates.push({
        name,
        userId:
          interaction.user.id
      });

      election.votes[name] = 0;

      await updateCandidateList(
        interaction
      );

      await log(
        guildId,
        `👤 후보 등록
후보: ${name}
등록자: ${interaction.user.tag}`
      );

      return reply10(
        interaction,
        `✅ ${name} 후보가 등록되었습니다.`
      );
    }

    if (
      command === "후보목록"
    ) {

      const election =
        getElection(guildId);

      return interaction.reply({
        content:
          electionText(election),
        ephemeral: true
      });
    }

    if (
      command === "투표"
    ) {

      const election =
        getElection(guildId);

      if (!election.active) {
        return reply10(
          interaction,
          "진행 중인 선거가 없습니다."
        );
      }

      if (
        election.votedUsers.has(
          interaction.user.id
        )
      ) {
        return reply10(
          interaction,
          "❌ 이미 투표했습니다."
        );
      }

      const candidate =
        interaction.options
          .getString("후보")
          .trim();

      if (
        !Object.prototype
          .hasOwnProperty.call(
            election.votes,
            candidate
          )
      ) {
        return reply10(
          interaction,
          "존재하지 않는 후보입니다."
        );
      }

      election.votes[candidate]++;

      election.votedUsers.add(
        interaction.user.id
      );

      await log(
        guildId,
        `🗳️ 투표
투표자: ${interaction.user.tag}
후보: ${candidate}`
      );

      return reply10(
        interaction,
        `✅ ${candidate} 후보에게 투표했습니다.`
      );
    }

    if (
      command === "선거종료"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const election =
        getElection(guildId);

      if (!election.active) {
        return reply10(
          interaction,
          "진행 중인 선거가 없습니다."
        );
      }

      election.active =
        false;

      const result =
        electionText(
          election
        );

      await log(
        guildId,
        `🏁 선거 종료

${result}`
      );

      return interaction.reply({
        content:
          `🏁 **선거 종료**\n\n${result}`,
        ephemeral: false
      });
    }

    if (
      command === "결과"
    ) {

      const election =
        getElection(guildId);

      return interaction.reply({
        content:
          electionText(
            election
          ),
        ephemeral: true
      });
    }

    /* =====================
       돈
    ===================== */

    if (
      command === "돈추가" ||
      command === "돈제거" ||
      command === "면세돈추가" ||
      command === "면세돈제거"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const target =
        interaction.options
          .getUser("대상");

      const amountText =
        interaction.options
          .getString("금액");

      let amount;

      try {
        amount =
          BigInt(amountText);
      } catch {
        return reply10(
          interaction,
          "금액이 올바르지 않습니다."
        );
      }

      if (amount <= 0n) {
        return reply10(
          interaction,
          "금액은 1원 이상이어야 합니다."
        );
      }

      const targetData =
        getUser(
          guildId,
          target.id
        );

      const taxFree =
        command.startsWith(
          "면세"
        );

      const add =
        command.includes(
          "추가"
        );

      const field =
        taxFree
          ? "taxFree"
          : "money";

      const current =
        BigInt(
          String(
            targetData[field] || "0"
          )
        );

      targetData[field] =
        (
          add
            ? current + amount
            : current - amount < 0n
              ? 0n
              : current - amount
        ).toString();

      save();

      await log(
        guildId,
        `${add ? "➕" : "➖"} ${
          taxFree
            ? "면세금"
            : "돈"
        } ${add ? "추가" : "제거"}

대상: ${target.tag}
금액: ${money(amount)}`
      );

      return reply10(
        interaction,
        `✅ 처리 완료\n${target.tag} / ${money(amount)}`
      );
    }

    if (
      command === "잔액"
    ) {

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      return interaction.reply({
        content:
`💰 **잔액**

현금: ${money(user.money)}
은행: ${money(user.bank)}
면세금: ${money(user.taxFree)}`,
        ephemeral: true
      });
    }

    /* =====================
       세율
    ===================== */

    if (
      command === "세금률설정"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      guildData.taxRate =
        interaction.options
          .getInteger("세율");

      save();

      await log(
        guildId,
        `💸 세율 변경
세율: ${guildData.taxRate}%`
      );

      return reply10(
        interaction,
        `✅ 세율이 ${guildData.taxRate}%로 설정되었습니다.`
      );
    }

    /* =====================
       주식
    ===================== */

    if (
      command === "주식참여"
    ) {
      return reply10(
        interaction,
        "✅ 주식 거래 참여가 활성화되었습니다."
      );
    }

    if (
      command === "주식목록"
    ) {

      const names =
        Object.keys(
          guildData.stocks
        );

      let text =
        `📈 **주식 목록**\n\n`;

      for (
        const name of names
      ) {
        const stock =
          guildData.stocks[name];

        text +=
`**${name}**
가격: ${Number(stock.price).toLocaleString("ko-KR")}원
종류: ${
  stock.type === "large"
    ? "대형"
    : "소형"
}
세율: ${guildData.taxRate}%

`;
      }

      if (!names.length) {
        text +=
          "등록된 주식이 없습니다.";
      }

      return interaction.reply({
        content: text,
        ephemeral: true
      });
    }

    if (
      command === "매수"
    ) {
      return buyStock(
        interaction,
        interaction.options
          .getString("주식"),
        interaction.options
          .getInteger("수량"),
        false
      );
    }

    if (
      command === "면세매수"
    ) {
      return buyStock(
        interaction,
        interaction.options
          .getString("주식"),
        interaction.options
          .getInteger("수량"),
        true
      );
    }

    if (
      command === "매도"
    ) {
      return sellStock(
        interaction,
        interaction.options
          .getString("주식"),
        interaction.options
          .getInteger("수량"),
        false
      );
    }

    if (
      command === "면세매도"
    ) {
      return sellStock(
        interaction,
        interaction.options
          .getString("주식"),
        interaction.options
          .getInteger("수량"),
        true
      );
    }

    if (
      command === "내주식"
    ) {

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      let text =
        "📊 **내 주식**\n\n";

      for (
        const name of
        Object.keys(
          user.stocks || {}
        )
      ) {

        const stock =
          guildData.stocks[name];

        if (!stock) continue;

        const qty =
          userShares(
            user,
            name
          );

        const total =
          totalShares(
            guildData,
            name
          );

        const value =
          qty *
          Number(stock.price);

        const percent =
          total > 0
            ? (
                qty /
                total *
                100
              ).toFixed(2)
            : "0.00";

        text +=
`**${name}**
${qty}주
평가액: ${value.toLocaleString("ko-KR")}원
지분: ${percent}%

`;
      }

      return interaction.reply({
        content: text,
        ephemeral: true
      });
    }

    if (
      command === "주식랭킹"
    ) {

      const users =
        Object.entries(
          guildData.users
        );

      const ranking =
        users
          .map(
            ([id, u]) => {

              let value = 0;

              for (
                const name of
                Object.keys(
                  u.stocks || {}
                )
              ) {

                const stock =
                  guildData.stocks[name];

                if (!stock) continue;

                value +=
                  userShares(
                    u,
                    name
                  ) *
                  Number(
                    stock.price
                  );
              }

              return {
                id,
                value
              };
            }
          )
          .sort(
            (a, b) =>
              b.value -
              a.value
          )
          .slice(0, 10);

      let text =
        "🏆 **주식 랭킹**\n\n";

      ranking.forEach(
        (item, i) => {
          text +=
`${i + 1}위 <@${item.id}> — ${item.value.toLocaleString("ko-KR")}원
`;
        }
      );

      return interaction.reply({
        content:
          text,
        ephemeral: true
      });
    }

    if (
      command === "주식메뉴"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      guildData.stockMenuChannelId =
        interaction.channelId;

      const message =
        await interaction.channel.send({
          embeds: [
            stockMenuEmbed(
              guildId
            )
          ],
          components:
            stockMenuRows()
        });

      guildData.stockMenuMessageId =
        message.id;

      save();

      return reply10(
        interaction,
        "✅ 주식 메뉴가 생성되었습니다."
      );
    }

    if (
      command === "주식추가"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

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

      if (
        guildData.stocks[name]
      ) {
        return reply10(
          interaction,
          "이미 존재하는 주식입니다."
        );
      }

      if (
        Object.keys(
          guildData.stocks
        ).length >= 20
      ) {
        return reply10(
          interaction,
          "주식 종류는 최대 20개까지 등록할 수 있습니다."
        );
      }

      if (
        type !== "small" &&
        type !== "large"
      ) {
        return reply10(
          interaction,
          "주식 종류가 올바르지 않습니다."
        );
      }

      guildData.stocks[name] = {
        price,
        type,
        chairmanUserId:
          null
      };

      save();

      await updateStockMenu(
        guildId
      );

      await log(
        guildId,
        `📈 주식 추가
${name}
가격: ${price.toLocaleString("ko-KR")}원
종류: ${type}`
      );

      return reply10(
        interaction,
        `✅ ${name} 주식이 추가되었습니다.`
      );
    }

    if (
      command === "주식삭제"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const name =
        interaction.options
          .getString("이름")
          .trim();

      const stock =
        guildData.stocks[name];

      if (!stock) {
        return reply10(
          interaction,
          "존재하지 않는 주식입니다."
        );
      }

      const holders =
        Object.values(
          guildData.users
        ).some(
          u =>
            userShares(
              u,
              name
            ) > 0
        );

      if (holders) {
        return reply10(
          interaction,
          "❌ 누군가 이 주식을 보유 중이라 삭제할 수 없습니다."
        );
      }

      delete guildData.stocks[name];

      save();

      await updateStockMenu(
        guildId
      );

      await log(
        guildId,
        `🗑️ 주식 삭제
${name}`
      );

      return reply10(
        interaction,
        `✅ ${name} 주식이 삭제되었습니다.`
      );
    }

    if (
      command === "주식가격"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const name =
        interaction.options
          .getString("이름");

      const price =
        interaction.options
          .getInteger("가격");

      const stock =
        guildData.stocks[name];

      if (!stock) {
        return reply10(
          interaction,
          "존재하지 않는 주식입니다."
        );
      }

      stock.price =
        price;

      save();

      await updateStockMenu(
        guildId
      );

      await log(
        guildId,
        `💹 주식 가격 변경
${name}
가격: ${price.toLocaleString("ko-KR")}원`
      );

      return reply10(
        interaction,
        `✅ ${name} 가격이 ${price.toLocaleString("ko-KR")}원으로 변경되었습니다.`
      );
    }

    if (
      command === "주식양도" ||
      command === "지분양도"
    ) {

      const target =
        interaction.options
          .getUser("대상");

      const name =
        interaction.options
          .getString("주식");

      const quantity =
        interaction.options
          .getInteger("수량");

      return transferStock(
        interaction,
        target,
        name,
        quantity
      );
    }

    if (
      command === "회장지정"
    ) {

      const name =
        interaction.options
          .getString("회사");

      const target =
        interaction.options
          .getUser("대상");

      return setChairman(
        interaction,
        name,
        target
      );
    }

    if (
      command === "지분추가"
    ) {

      const target =
        interaction.options
          .getUser("대상");

      const name =
        interaction.options
          .getString("회사");

      const quantity =
        interaction.options
          .getInteger("수량");

      return addShares(
        interaction,
        target,
        name,
        quantity
      );
    }

    if (
      command === "지분제거"
    ) {

      const target =
        interaction.options
          .getUser("대상");

      const name =
        interaction.options
          .getString("회사");

      const quantity =
        interaction.options
          .getInteger("수량");

      return removeShares(
        interaction,
        target,
        name,
        quantity
      );
    }

    /* =====================
       은행
    ===================== */

    if (
      command === "은행"
    ) {

      return interaction.reply({
        content:
`🏦 **은행 메뉴**

💰 입금
\`/은행입금 금액:\`

💸 출금
\`/은행출금 금액:\`

💵 송금
\`/송금 대상: 금액:\`

💎 적금
\`/적금가입 금액: 기간:\`

📋 적금 확인
\`/적금목록\``,
        ephemeral: true
      });
    }

    if (
      command === "은행입금"
    ) {

      if (
        isPaused(guildData)
      ) {
        return reply10(
          interaction,
          "🚨 경제가 비상정지 상태입니다."
        );
      }

      const amountText =
        interaction.options
          .getString("금액");

      let amount;

      try {
        amount =
          BigInt(amountText);
      } catch {
        return reply10(
          interaction,
          "금액이 올바르지 않습니다."
        );
      }

      if (amount <= 0n) {
        return reply10(
          interaction,
          "금액은 1원 이상이어야 합니다."
        );
      }

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      const cash =
        BigInt(
          String(user.money)
        );

      if (cash < amount) {
        return reply10(
          interaction,
          "현금이 부족합니다."
        );
      }

      user.money =
        (
          cash - amount
        ).toString();

      user.bank =
        (
          BigInt(
            String(user.bank)
          ) + amount
        ).toString();

      save();

      await log(
        guildId,
        `🏦 은행 입금
${interaction.user.tag}
${money(amount)}`
      );

      return reply10(
        interaction,
        `✅ ${money(amount)} 입금 완료`
      );
    }

    if (
      command === "은행출금"
    ) {

      if (
        isPaused(guildData)
      ) {
        return reply10(
          interaction,
          "🚨 경제가 비상정지 상태입니다."
        );
      }

      const amountText =
        interaction.options
          .getString("금액");

      let amount;

      try {
        amount =
          BigInt(amountText);
      } catch {
        return reply10(
          interaction,
          "금액이 올바르지 않습니다."
        );
      }

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      const bank =
        BigInt(
          String(user.bank)
        );

      if (
        amount <= 0n ||
        bank < amount
      ) {
        return reply10(
          interaction,
          "은행 잔액이 부족합니다."
        );
      }

      user.bank =
        (
          bank - amount
        ).toString();

      user.money =
        (
          BigInt(
            String(user.money)
          ) + amount
        ).toString();

      save();

      await log(
        guildId,
        `🏦 은행 출금
${interaction.user.tag}
${money(amount)}`
      );

      return reply10(
        interaction,
        `✅ ${money(amount)} 출금 완료`
      );
    }

    if (
      command === "송금"
    ) {

      if (
        isPaused(guildData)
      ) {
        return reply10(
          interaction,
          "🚨 경제가 비상정지 상태입니다."
        );
      }

      const target =
        interaction.options
          .getUser("대상");

      const amountText =
        interaction.options
          .getString("금액");

      let amount;

      try {
        amount =
          BigInt(amountText);
      } catch {
        return reply10(
          interaction,
          "금액이 올바르지 않습니다."
        );
      }

      if (
        amount <= 0n
      ) {
        return reply10(
          interaction,
          "금액은 1원 이상이어야 합니다."
        );
      }

      if (
        target.id ===
        interaction.user.id
      ) {
        return reply10(
          interaction,
          "자기 자신에게 송금할 수 없습니다."
        );
      }

      const sender =
        getUser(
          guildId,
          interaction.user.id
        );

      const receiver =
        getUser(
          guildId,
          target.id
        );

      const senderMoney =
        BigInt(
          String(
            sender.money
          )
        );

      if (
        senderMoney < amount
      ) {
        return reply10(
          interaction,
          "현금이 부족합니다."
        );
      }

      sender.money =
        (
          senderMoney -
          amount
        ).toString();

      receiver.money =
        (
          BigInt(
            String(
              receiver.money
            )
          ) + amount
        ).toString();

      save();

      await log(
        guildId,
        `💸 송금
보낸 사람: ${interaction.user.tag}
받은 사람: ${target.tag}
금액: ${money(amount)}`
      );

      return reply10(
        interaction,
        `✅ ${target.tag}에게 ${money(amount)} 송금 완료`
      );
    }

    /* =====================
       적금
    ===================== */

    if (
      command === "적금가입"
    ) {

      if (
        isPaused(guildData)
      ) {
        return reply10(
          interaction,
          "🚨 경제가 비상정지 상태입니다."
        );
      }

      const amountText =
        interaction.options
          .getString("금액");

      const months =
        interaction.options
          .getInteger("기간");

      let amount;

      try {
        amount =
          BigInt(amountText);
      } catch {
        return reply10(
          interaction,
          "금액이 올바르지 않습니다."
        );
      }

      if (
        amount <= 0n
      ) {
        return reply10(
          interaction,
          "금액은 1원 이상이어야 합니다."
        );
      }

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      const cash =
        BigInt(
          String(user.money)
        );

      if (
        cash < amount
      ) {
        return reply10(
          interaction,
          "현금이 부족합니다."
        );
      }

      const rate =
        months === 1
          ? 2.1
          : 3.0;

      const start =
        Date.now();

      const end =
        start +
        months *
        30 *
        24 *
        60 *
        60 *
        1000;

      user.money =
        (
          cash - amount
        ).toString();

      user.savings =
        user.savings || [];

      user.savings.push({
        principal:
          amount.toString(),
        months,
        rate,
        start,
        end
      });

      save();

      await log(
        guildId,
        `💎 적금 가입
${interaction.user.tag}
금액: ${money(amount)}
기간: ${months}개월
금리: ${rate}%`
      );

      return reply10(
        interaction,
`✅ 적금 가입 완료

금액: ${money(amount)}
기간: ${months}개월
금리: ${rate}%`
      );
    }

    if (
      command === "적금목록"
    ) {

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      const savings =
        user.savings || [];

      if (!savings.length) {
        return interaction.reply({
          content:
            "현재 가입한 적금이 없습니다.",
          ephemeral: true
        });
      }

      let text =
        "💎 **적금 목록**\n\n";

      savings.forEach(
        (s, i) => {

          const principal =
            BigInt(
              String(
                s.principal
              )
            );

          text +=
`${i + 1}. ${money(principal)}
기간: ${s.months}개월
금리: ${s.rate}%
만기: <t:${Math.floor(s.end / 1000)}:F>

`;
        }
      );

      return interaction.reply({
        content: text,
        ephemeral: true
      });
    }

    if (
      command === "적금해지"
    ) {

      if (
        isPaused(guildData)
      ) {
        return reply10(
          interaction,
          "🚨 경제가 비상정지 상태입니다."
        );
      }

      const index =
        interaction.options
          .getInteger("번호") - 1;

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      const savings =
        user.savings || [];

      if (
        !savings[index]
      ) {
        return reply10(
          interaction,
          "해당 적금을 찾을 수 없습니다."
        );
      }

      const saving =
        savings[index];

      const principal =
        BigInt(
          String(
            saving.principal
          )
        );

      const earlyInterest =
        (
          principal *
          1n
        ) / 100n;

      const payout =
        principal +
        earlyInterest;

      user.money =
        (
          BigInt(
            String(
              user.money
            )
          ) + payout
        ).toString();

      savings.splice(
        index,
        1
      );

      save();

      await log(
        guildId,
        `💎 적금 중도해지
${interaction.user.tag}
원금: ${money(principal)}
지급: ${money(payout)}`
      );

      return reply10(
        interaction,
        `✅ 적금 해지 완료\n지급액: ${money(payout)}`
      );
    }

    if (
      command === "적금만기"
    ) {

      if (
        isPaused(guildData)
      ) {
        return reply10(
          interaction,
          "🚨 경제가 비상정지 상태입니다."
        );
      }

      const user =
        getUser(
          guildId,
          interaction.user.id
        );

      const savings =
        user.savings || [];

      const now =
        Date.now();

      let payout =
        0n;

      const remaining = [];

      for (
        const saving of savings
      ) {

        if (
          now <
          saving.end
        ) {
          remaining.push(
            saving
          );
          continue;
        }

        const principal =
          BigInt(
            String(
              saving.principal
            )
          );

        const interest =
          BigInt(
            Math.floor(
              Number(
                principal
              ) *
              saving.rate /
              100
            )
          );

        payout +=
          principal +
          interest;
      }

      user.savings =
        remaining;

      user.money =
        (
          BigInt(
            String(
              user.money
            )
          ) + payout
        ).toString();

      save();

      if (payout === 0n) {
        return reply10(
          interaction,
          "아직 만기된 적금이 없습니다."
        );
      }

      await log(
        guildId,
        `💎 적금 만기
${interaction.user.tag}
지급: ${money(payout)}`
      );

      return reply10(
        interaction,
        `✅ 만기 처리 완료\n지급액: ${money(payout)}`
      );
    }

    /* =====================
       인플레이션
    ===================== */

    if (
      command === "인플레이션설정"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const value =
        interaction.options
          .getInteger("비율");

      const wasPaused =
        guildData.economyPaused;

      guildData.inflation =
        value;

      if (
        value >=
        guildData.inflationLimit
      ) {
        guildData.economyPaused =
          true;
      }

      save();

      if (
        !wasPaused &&
        guildData.economyPaused
      ) {

        await createInflationSnapshot(
          guildId
        );

        for (
          const user of
          Object.values(
            guildData.users
          )
        ) {

          for (
            const name of
            Object.keys(
              user.stocks || {}
            )
          ) {

            if (
              userShares(
                user,
                name
              ) > 0
            ) {

              user.stocks[name] =
                userShares(
                  user,
                  name
                ) - 1;

              if (
                user.stocks[name] <= 0
              ) {
                delete user.stocks[name];
              }
            }
          }
        }

        save();

        await updateStockMenu(
          guildId
        );

        await log(
          guildId,
`🚨 **인플레이션 비상정지 발동**

인플레이션:
${value}%

기준:
${guildData.inflationLimit}%

보유 주식에서 1주씩 조정되었습니다.

경제 규모 스냅샷을 저장했습니다.`
        );
      }

      return reply10(
        interaction,
`📊 인플레이션:
${value}%

경제 상태:
${
  guildData.economyPaused
    ? "🚨 비상정지"
    : "🟢 정상"
}`
      );
    }

    if (
      command === "인플레이션기준설정"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const value =
        interaction.options
          .getInteger("비율");

      guildData.inflationLimit =
        value;

      save();

      return reply10(
        interaction,
        `✅ 경제 비상정지 기준이 ${value}%로 설정되었습니다.`
      );
    }

    if (
      command === "경제상태"
    ) {

      return interaction.reply({
        content:
`🏦 **경제 상태**

인플레이션:
${guildData.inflation}%

비상정지 기준:
${guildData.inflationLimit}%

상태:
${
  guildData.economyPaused
    ? "🚨 비상정지"
    : "🟢 정상"
}

주식 세율:
${guildData.taxRate}%`,
        ephemeral: true
      });
    }

    if (
      command === "경제정지해제"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      guildData.economyPaused =
        false;

      guildData
        .inflationEmergencySnapshot =
        null;

      save();

      await log(
        guildId,
        `🟢 경제 비상정지 해제
관리자: ${interaction.user.tag}`
      );

      return reply10(
        interaction,
        "🟢 경제 비상정지가 해제되었습니다."
      );
    }

    if (
      command === "경제관리자역할"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const role =
        interaction.options
          .getRole("역할");

      guildData.economyAdminRoleId =
        role.id;

      save();

      await log(
        guildId,
        `👮 경제 관리자 역할 지정
역할: ${role.name}`
      );

      return reply10(
        interaction,
        `✅ 경제 관리자 역할: <@&${role.id}>`
      );
    }

    if (
      command === "로그채널"
    ) {

      if (!isAdmin(interaction)) {
        return reply10(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const channel =
        interaction.options
          .getChannel("채널");

      guildData.logChannelId =
        channel.id;

      save();

      return reply10(
        interaction,
        `✅ 로그 채널이 ${channel}로 설정되었습니다.`
      );
    }

  } catch (error) {

    console.error(
      "interaction error:",
      error
    );

    if (
      interaction.replied ||
      interaction.deferred
    ) {
      try {
        await interaction.followUp({
          content:
            "❌ 처리 중 오류가 발생했습니다.",
          ephemeral: true
        });
      } catch {}
    } else {
      try {
        await interaction.reply({
          content:
            "❌ 처리 중 오류가 발생했습니다.",
          ephemeral: true
        });
      } catch {}
    }
  }
});

/* =========================
   Discord 로그인 / 명령어 등록
========================= */

client.once(
  "ready",
  async () => {

    console.log(
      `✅ 로그인 완료: ${client.user.tag}`
    );

    try {

      /*
       * 기존 글로벌 명령어 제거
       * 중복 명령어 방지
       */
      await rest.put(
        Routes.applicationCommands(
          CLIENT_ID
        ),
        {
          body: []
        }
      );

      const commandData =
        commands().map(
          command =>
            command.toJSON()
        );

      for (
        const guild of
        client.guilds.cache.values()
      ) {

        try {

          await rest.put(
            Routes.applicationGuildCommands(
              CLIENT_ID,
              guild.id
            ),
            {
              body: commandData
            }
          );

          console.log(
            `명령어 등록 완료: ${guild.name}`
          );

        } catch (error) {

          console.error(
            `명령어 등록 실패: ${guild.name}`,
            error
          );
        }
      }

    } catch (error) {

      console.error(
        "명령어 등록 오류:",
        error
      );
    }
  }
);

/* =========================
   새 서버 입장
========================= */

client.on(
  "guildCreate",
  async guild => {

    getGuild(
      guild.id
    );

    save();

    try {

      const commandData =
        commands().map(
          command =>
            command.toJSON()
        );

      await rest.put(
        Routes.applicationGuildCommands(
          CLIENT_ID,
          guild.id
        ),
        {
          body: commandData
        }
      );

      console.log(
        `새 서버 명령어 등록: ${guild.name}`
      );

    } catch (error) {

      console.error(
        "새 서버 명령어 등록 실패:",
        error
      );
    }
  }
);

/* =========================
   자동 주식 가격 변동
========================= */

setInterval(
  async () => {

    try {

      for (
        const guild of
        client.guilds.cache.values()
      ) {

        const guildData =
          getGuild(
            guild.id
          );

        if (
          guildData.economyPaused
        ) continue;

        if (
          !isKrxOpen()
        ) continue;

        let changed = false;

        for (
          const [
            name,
            stock
          ] of Object.entries(
            guildData.stocks
          )
        ) {

          const oldPrice =
            Number(
              stock.price
            );

          if (
            oldPrice <= 0
          ) continue;

          const movement =
            (
              Math.random() *
              10
            ) - 5;

          const newPrice =
            Math.max(
              1,
              Math.round(
                oldPrice *
                (
                  1 +
                  movement /
                  100
                )
              )
            );

          stock.price =
            newPrice;

          changed = true;

          await log(
            guild.id,
`📈 자동 주가 변동

${name}
${oldPrice.toLocaleString("ko-KR")}원
→
${newPrice.toLocaleString("ko-KR")}원`
          );
        }

        if (changed) {

          save();

          await updateStockMenu(
            guild.id
          );
        }
      }

    } catch (error) {

      console.error(
        "자동 주가 변동 오류:",
        error
      );
    }

  },
  5 * 60 * 1000
);

/* =========================
   로그인
========================= */

client.login(
  TOKEN
);
