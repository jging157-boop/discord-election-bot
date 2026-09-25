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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

let data = {
  guilds: {}
};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );
  } catch {
    data = { guilds: {} };
  }
}

if (!data.guilds) data.guilds = {};

function save() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

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

  const g = data.guilds[guildId];

  if (!g.users) g.users = {};
  if (!g.stocks) g.stocks = {};

  if (typeof g.taxRate !== "number") {
    g.taxRate = DEFAULT_TAX_RATE;
  }

  if (typeof g.inflation !== "number") {
    g.inflation = 0;
  }

  if (typeof g.inflationLimit !== "number") {
    g.inflationLimit = 20;
  }

  if (typeof g.economyPaused !== "boolean") {
    g.economyPaused = false;
  }

  if (
    !g.inflationEmergencySnapshot ||
    typeof g.inflationEmergencySnapshot !== "object"
  ) {
    g.inflationEmergencySnapshot = null;
  }

  if (!g.stocks["WB그룹"]) {
    g.stocks["WB그룹"] = {
      price: 2000,
      type: "small",
      chairmanUserId: null
    };
  }

  if (!g.stocks["유마그룹"]) {
    g.stocks["유마그룹"] = {
      price: 3000,
      type: "small",
      chairmanUserId: null
    };
  }

  for (const stock of Object.values(g.stocks)) {
    if (stock.chairmanUserId === undefined) {
      stock.chairmanUserId = null;
    }
  }

  return g;
}

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

  const u = guildData.users[userId];

  if (!u.stocks) u.stocks = {};
  if (!Array.isArray(u.savings)) u.savings = [];

  if (u.money == null) u.money = "0";
  if (u.taxFreeMoney == null) u.taxFreeMoney = "0";
  if (u.bank == null) u.bank = "0";

  return u;
}

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
  const n = big(value);
  return n < 0n ? -n : n;
}

function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions &&
    interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function isPaused(guildData) {
  return guildData.economyPaused === true;
}

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

  if (!guildData.logChannelId) return;

  const guild =
    client.guilds.cache.get(guildId);

  if (!guild) return;

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
      (name, i) =>
        `${i + 1}. ${name}`
    )
    .join("\n");
}

async function updateCandidateList(
  guildId
) {
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

  if (!guild) return;

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
   주식
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
    const user of
    Object.values(guildData.users)
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
    const [name, quantity] of
    Object.entries(user.stocks || {})
  ) {
    const stock =
      guildData.stocks[name];

    if (!stock) continue;

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

  if (total <= 0) return 0;

  return (
    userShares(
      user,
      stockName
    ) /
    total
  ) * 100;
}

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
      const [name, stock] of entries
    ) {
      text +=
`**${name}**
현재가: ${Math.round(
  stock.price
).toLocaleString("ko-KR")}원
종류: ${
  stock.type === "small"
    ? "소형"
    : "대형"
}
전체 보유량: ${
  totalShares(
    guildData,
    name
  )
}주

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

${
  guildData.economyPaused
    ? "🚨 경제 비상정지"
    : "🟢 거래 가능"
}

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

  if (!guild) return;

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
        stockMenuEmbed(
          guildData
        )
      ],
      components:
        stockMenuRows()
    });
  } catch {}
}

/* =========================
   은행
========================= */

function bankMenuEmbed(
  guildData,
  user
) {
  return new EmbedBuilder()
    .setTitle("🏦 은행")
    .setDescription(
`💵 현금: ${money(user.money)}
🏦 은행: ${money(user.bank)}
🛡️ 면세돈: ${money(
  user.taxFreeMoney
)}

━━━━━━━━━━━━━━
💳 적금 금리

1개월: 연 ${
  SAVINGS_RATES[1]
}%
3개월: 연 ${
  SAVINGS_RATES[3]
}%

💰 적금 이자소득세: ${
  SAVINGS_TAX
}%
`
    )
    .setTimestamp();
}

function bankMenuRows() {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "bank_deposit"
          )
          .setLabel("💵 입금")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "bank_withdraw"
          )
          .setLabel("💸 출금")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "bank_transfer"
          )
          .setLabel("💰 송금")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "bank_savings"
          )
          .setLabel("💳 적금")
          .setStyle(
            ButtonStyle.Success
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "bank_savings_list"
          )
          .setLabel("📋 적금 목록")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("wallet")
          .setLabel("👛 내 지갑")
          .setStyle(
            ButtonStyle.Secondary
          )
      )
  ];
}

async function updateBankMenu(
  guildId
) {
  const guildData =
    getGuild(guildId);

  if (
    !guildData.bankMenuChannelId ||
    !guildData.bankMenuMessageId
  ) {
    return;
  }

  const guild =
    client.guilds.cache.get(
      guildId
    );

  if (!guild) return;

  const channel =
    guild.channels.cache.get(
      guildData.bankMenuChannelId
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
        guildData.bankMenuMessageId
      );

    const dummyUser = {
      money: "0",
      bank: "0",
      taxFreeMoney: "0"
    };

    await message.edit({
      embeds: [
        bankMenuEmbed(
          guildData,
          dummyUser
        ).setDescription(
`🏦 은행 거래 메뉴

💳 적금 금리
1개월: 연 ${
  SAVINGS_RATES[1]
}%
3개월: 연 ${
  SAVINGS_RATES[3]
}%

💰 적금 이자소득세: ${
  SAVINGS_TAX
}%

${
  guildData.economyPaused
    ? "🚨 현재 경제 비상정지 상태입니다."
    : "🟢 현재 거래 가능합니다."
}`
        )
      ],
      components:
        bankMenuRows()
    });
  } catch {}
}

/* =========================
   적금
========================= */

function savingsInterest(
  principal,
  months,
  rate
) {
  const p = big(principal);

  return (
    p *
    BigInt(
      Math.round(rate * 100)
    ) *
    BigInt(months)
  ) /
  10000n /
  12n;
}

function savingsListText(user) {
  if (!user.savings.length) {
    return "가입한 적금이 없습니다.";
  }

  return user.savings
    .map(
      (s, i) =>
`${i + 1}. ${money(s.principal)}
기간: ${s.months}개월
금리: 연 ${s.rate}%
가입일: <t:${Math.floor(
  s.createdAt / 1000
)}:f>
만기: <t:${Math.floor(
  s.maturityAt / 1000
)}:f>`
    )
    .join("\n\n");
}

/* =========================
   경제 스냅샷
========================= */

function economySnapshot(
  guildData
) {
  let cash = 0n;
  let taxFree = 0n;
  let bank = 0n;
  let savings = 0n;
  let stocks = 0n;

  for (
    const user of
    Object.values(
      guildData.users
    )
  ) {
    cash += big(user.money);
    taxFree +=
      big(user.taxFreeMoney);
    bank += big(user.bank);

    for (
      const s of
      user.savings || []
    ) {
      savings +=
        big(s.principal);
    }

    for (
      const [
        name,
        quantity
      ] of Object.entries(
        user.stocks || {}
      )
    ) {
      const stock =
        guildData.stocks[name];

      if (!stock) continue;

      stocks +=
        BigInt(
          Math.round(
            stock.price
          )
        ) *
        BigInt(quantity);
    }
  }

  const locked =
    bank +
    savings +
    stocks;

  const total =
    cash +
    taxFree +
    bank +
    savings +
    stocks;

  return {
    cash: String(cash),
    taxFree: String(
      taxFree
    ),
    bank: String(bank),
    savings: String(
      savings
    ),
    stocks: String(
      stocks
    ),
    locked: String(
      locked
    ),
    total: String(
      total
    )
  };
}

async function triggerInflationEmergency(
  guildId,
  guildData
) {
  if (guildData.economyPaused) {
    return;
  }

  guildData.economyPaused =
    true;

  const snapshot =
    economySnapshot(
      guildData
    );

  guildData
    .inflationEmergencySnapshot =
    snapshot;

  let removedCount = 0;
  const removedLines = [];

  for (
    const [
      userId,
      user
    ] of Object.entries(
      guildData.users
    )
  ) {
    for (
      const [
        stockName,
        quantity
      ] of Object.entries(
        user.stocks || {}
      )
    ) {
      const q =
        Number(quantity || 0);

      if (q <= 0) continue;

      user.stocks[stockName] =
        q - 1;

      removedCount++;

      removedLines.push(
        `<@${userId}> — ${stockName} -1주`
      );
    }
  }

  save();

  const guild =
    client.guilds.cache.get(
      guildId
    );

  if (
    !guild ||
    !guildData.logChannelId
  ) {
    return;
  }

  const channel =
    guild.channels.cache.get(
      guildData.logChannelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  const roleMention =
    guildData.economyAdminRoleId
      ? `<@&${guildData.economyAdminRoleId}>`
      : "";

  const removalText =
    removedCount
      ? removedLines
          .slice(0, 100)
          .join("\n") +
        (
          removedLines.length > 100
            ? `\n...외 ${
                removedLines.length - 100
              }건`
            : ""
        )
      : "차감할 주식이 없습니다.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "🚨 인플레이션 경제 비상상황"
      )
      .setDescription(
`📈 인플레이션: ${
  guildData.inflation
}%
🛑 정지 기준: ${
  guildData.inflationLimit
}%

🏦 은행 거래: 정지
💳 적금 거래: 정지
💸 송금: 정지
📈 주식 거래: 정지
🤝 주식 양도: 정지

━━━━━━━━━━━━━━
💥 정지 시점 경제 규모
━━━━━━━━━━━━━━
💵 현금: ${
  money(snapshot.cash)
}
🛡️ 면세돈: ${
  money(snapshot.taxFree)
}
🏦 은행: ${
  money(snapshot.bank)
}
💳 적금 원금: ${
  money(snapshot.savings)
}
📈 주식 평가액: ${
  money(snapshot.stocks)
}

🔒 거래 정지 자산:
${money(snapshot.locked)}

💰 전체 경제 자산:
${money(snapshot.total)}

━━━━━━━━━━━━━━
📉 인플레이션 주식 차감
━━━━━━━━━━━━━━
보유 중인 모든 종목에서
보유자마다 1주씩 자동 차감

총 차감: ${
  removedCount
}주

${removalText}`
      )
      .setTimestamp();

  try {
    await channel.send({
      content:
        roleMention ||
        undefined,

      embeds: [embed],

      allowedMentions:
        guildData.economyAdminRoleId
          ? {
              roles: [
                guildData.economyAdminRoleId
              ]
            }
          : {
              parse: []
            }
    });
  } catch {}
}

/* =========================
   KRX 시간
========================= */

function kstNow() {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hourCycle: "h23"
      }
    ).formatToParts(
      new Date()
    );

  const obj = {};

  for (const p of parts) {
    obj[p.type] = p.value;
  }

  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    second: Number(obj.second)
  };
}

function isKrxOpen() {
  const now =
    kstNow();

  const weekday =
    new Date(
      `${String(now.year).padStart(
        4,
        "0"
      )}-${String(now.month).padStart(
        2,
        "0"
      )}-${String(now.day).padStart(
        2,
        "0"
      )}T00:00:00+09:00`
    ).getUTCDay();

  if (
    weekday === 0 ||
    weekday === 6
  ) {
    return false;
  }

  const minutes =
    now.hour * 60 +
    now.minute;

  return (
    minutes >= 9 * 60 &&
    minutes <=
      15 * 60 + 30
  );
}

async function moveStockPrices() {
  if (!isKrxOpen()) return;

  for (
    const [
      guildId,
      guildData
    ] of Object.entries(
      data.guilds
    )
  ) {
    if (!guildData.stocks) {
      continue;
    }

    for (
      const [
        name,
        stock
      ] of Object.entries(
        guildData.stocks
      )
    ) {
      const old =
        Number(
          stock.price || 1
        );

      const random =
        Math.random() * 1.6 -
        0.8;

      const next =
        Math.max(
          1,
          Math.round(
            old *
            (
              1 +
              random / 100
            )
          )
        );

      if (next === old) {
        continue;
      }

      stock.price = next;

      await log(
        guildId,
        "📊 주식 가격 변동",
        `${name}
이전: ${old.toLocaleString(
  "ko-KR"
)}원
현재: ${next.toLocaleString(
  "ko-KR"
)}원
등락: ${(
  (next - old) /
  old *
  100
).toFixed(2)}%`
      );
    }

    save();

    await updateStockMenu(
      guildId
    );
  }
}

/* =========================
   명령어
========================= */

function commands() {
  return [
    new SlashCommandBuilder()
      .setName("선거시작")
      .setDescription(
        "선거를 시작합니다."
      ),

    new SlashCommandBuilder()
      .setName("후보등록")
      .setDescription(
        "후보를 등록합니다."
      )
      .addStringOption(
        o =>
          o.setName("이름")
            .setDescription(
              "후보 이름"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("후보목록")
      .setDescription(
        "후보 목록을 표시합니다."
      ),

    new SlashCommandBuilder()
      .setName("투표")
      .setDescription(
        "투표합니다."
      )
      .addStringOption(
        o =>
          o.setName("후보")
            .setDescription(
              "후보 이름"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("선거종료")
      .setDescription(
        "선거를 종료합니다."
      ),

    new SlashCommandBuilder()
      .setName("결과")
      .setDescription(
        "현재 선거 결과를 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("돈추가")
      .setDescription(
        "관리자: 돈을 추가합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "대상"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("돈제거")
      .setDescription(
        "관리자: 돈을 제거합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "대상"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("면세돈추가")
      .setDescription(
        "관리자: 면세돈을 추가합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "대상"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("면세돈제거")
      .setDescription(
        "관리자: 면세돈을 제거합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "대상"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("잔액")
      .setDescription(
        "내 잔액을 확인합니다."
      ),

    new SlashCommandBuilder()
      .setName("은행")
      .setDescription(
        "은행 메뉴를 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("은행입금")
      .setDescription(
        "은행에 입금합니다."
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("은행출금")
      .setDescription(
        "은행에서 출금합니다."
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("송금")
      .setDescription(
        "다른 사람에게 송금합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "대상"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "금액"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("적금가입")
      .setDescription(
        "적금에 가입합니다."
      )
      .addStringOption(
        o =>
          o.setName("금액")
            .setDescription(
              "가입 금액"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("기간")
            .setDescription(
              "1개월 또는 3개월"
            )
            .setRequired(true)
            .addChoices(
              {
                name:
                  "1개월 - 연 2.1%",
                value: 1
              },
              {
                name:
                  "3개월 - 연 3.0%",
                value: 3
              }
            )
      ),

    new SlashCommandBuilder()
      .setName("적금목록")
      .setDescription(
        "내 적금을 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("적금해지")
      .setDescription(
        "적금을 중도해지합니다."
      )
      .addIntegerOption(
        o =>
          o.setName("번호")
            .setDescription(
              "적금 번호"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("적금만기")
      .setDescription(
        "만기된 적금을 수령합니다."
      ),

    new SlashCommandBuilder()
      .setName("주식참여")
      .setDescription(
        "주식 시스템을 이용합니다."
      ),

    new SlashCommandBuilder()
      .setName("주식목록")
      .setDescription(
        "주식 목록을 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("주식메뉴")
      .setDescription(
        "주식 거래 메뉴를 만듭니다."
      ),

    new SlashCommandBuilder()
      .setName("주식추가")
      .setDescription(
        "관리자: 주식을 추가합니다."
      )
      .addStringOption(
        o =>
          o.setName("이름")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("가격")
            .setDescription(
              "시작 가격"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("종류")
            .setDescription(
              "주식 종류"
            )
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
      .setDescription(
        "관리자: 주식을 삭제합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("주식가격")
      .setDescription(
        "관리자: 주식 가격을 변경합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("가격")
            .setDescription(
              "가격"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("회장지정")
      .setDescription(
        "관리자: 회사별 회장을 지정합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "회사/주식 이름"
            )
            .setRequired(true)
      )
      .addUserOption(
        o =>
          o.setName("회장")
            .setDescription(
              "회장으로 지정할 사람"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("지분추가")
      .setDescription(
        "회장/관리자: 지분을 추가합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "지분을 받을 사람"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "회사/주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "추가할 지분 수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("지분제거")
      .setDescription(
        "회장/관리자: 지분을 제거합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "지분을 제거할 사람"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "회사/주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "제거할 지분 수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("매수")
      .setDescription(
        "일반 돈으로 주식을 매수합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("매도")
      .setDescription(
        "일반 돈으로 주식을 매도합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("면세매수")
      .setDescription(
        "면세돈으로 주식을 매수합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("면세매도")
      .setDescription(
        "면세 주식을 매도합니다."
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("내주식")
      .setDescription(
        "내 주식을 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("주식랭킹")
      .setDescription(
        "주식 자산 랭킹을 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("주식양도")
      .setDescription(
        "주식을 다른 사람에게 양도합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "받는 사람"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("지분양도")
      .setDescription(
        "주식을 다른 사람에게 양도합니다."
      )
      .addUserOption(
        o =>
          o.setName("대상")
            .setDescription(
              "받는 사람"
            )
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o.setName("주식")
            .setDescription(
              "주식 이름"
            )
            .setRequired(true)
      )
      .addIntegerOption(
        o =>
          o.setName("수량")
            .setDescription(
              "수량"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("세금률설정")
      .setDescription(
        "관리자: 거래 세율을 설정합니다."
      )
      .addIntegerOption(
        o =>
          o.setName("세율")
            .setDescription(
              "0~100"
            )
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100)
      ),

    new SlashCommandBuilder()
      .setName("인플레이션설정")
      .setDescription(
        "관리자: 인플레이션을 설정합니다."
      )
      .addNumberOption(
        o =>
          o.setName("비율")
            .setDescription(
              "0~100"
            )
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100)
      ),

    new SlashCommandBuilder()
      .setName("인플레이션기준설정")
      .setDescription(
        "관리자: 경제정지 기준을 설정합니다."
      )
      .addNumberOption(
        o =>
          o.setName("비율")
            .setDescription(
              "0~100"
            )
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100)
      ),

    new SlashCommandBuilder()
      .setName("경제상태")
      .setDescription(
        "경제 상태를 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("경제정지해제")
      .setDescription(
        "관리자: 경제 정지를 해제합니다."
      ),

    new SlashCommandBuilder()
      .setName("경제관리자역할")
      .setDescription(
        "관리자: 인플레이션 알림 역할을 지정합니다."
      )
      .addRoleOption(
        o =>
          o.setName("역할")
            .setDescription(
              "멘션할 역할"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("로그채널")
      .setDescription(
        "관리자: 로그 채널을 지정합니다."
      )
      .addChannelOption(
        o =>
          o.setName("채널")
            .setDescription(
              "로그 채널"
            )
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText
            )
      ),

    new SlashCommandBuilder()
      .setName("관리자메뉴")
      .setDescription(
        "관리자 메뉴를 봅니다."
      ),

    new SlashCommandBuilder()
      .setName("은행메뉴")
      .setDescription(
        "관리자: 은행 메뉴를 만듭니다."
      )
  ].map(c => c.toJSON());
}

/* =========================
   모달
========================= */

function amountModal(
  customId,
  title
) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              "amount"
            )
            .setLabel("금액")
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
        )
    );
}

function stockTradeModal(
  customId,
  title
) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
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
    );
}

function savingsModal() {
  return new ModalBuilder()
    .setCustomId(
      "savings_modal"
    )
    .setTitle(
      "💳 적금 가입"
    )
    .addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              "amount"
            )
            .setLabel(
              "가입 금액"
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
              "months"
            )
            .setLabel(
              "기간: 1 또는 3"
            )
            .setPlaceholder(
              "1 또는 3"
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
        )
    );
}

/* =========================
   명령어 등록
========================= */

async function registerCommands(
  guildId
) {
  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      guildId
    ),
    {
      body: commands()
    }
  );
}

client.once(
  "ready",
  async () => {
    console.log(
      `로그인 완료: ${
        client.user.tag
      }`
    );

    for (
      const guild of
      client.guilds.cache.values()
    ) {
      try {
        await registerCommands(
          guild.id
        );
      } catch (err) {
        console.error(
          "명령어 등록 실패:",
          guild.id,
          err.message
        );
      }
    }

    console.log(
      "서버별 슬래시 명령어 등록 완료"
    );
  }
);

client.on(
  "guildCreate",
  async guild => {
    getGuild(guild.id);

    try {
      await registerCommands(
        guild.id
      );
    } catch (err) {
      console.error(
        "새 서버 명령어 등록 실패:",
        err.message
      );
    }
  }
);

/* =========================
   중요
   async가 반드시 있어야 함
========================= */

client.on(
  "interactionCreate",
  async interaction => {

  if (!interaction.guild) {
    return;
  }

  const guildId =
    interaction.guild.id;

  const guildData =
    getGuild(guildId);

  /* =========================
     버튼
  ========================= */

  if (interaction.isButton()) {
    const user =
      getUser(
        guildId,
        interaction.user.id
      );

    if (
      interaction.customId ===
      "wallet"
    ) {
      return interaction.reply({
        content:
`👛 지갑

💵 현금: ${money(user.money)}
🏦 은행: ${money(user.bank)}
🛡️ 면세돈: ${money(
  user.taxFreeMoney
)}`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "my_stocks"
    ) {
      let text = "";

      for (
        const [
          name,
          quantity
        ] of Object.entries(
          user.stocks
        )
      ) {
        if (quantity <= 0) {
          continue;
        }

        const stock =
          guildData.stocks[name];

        if (!stock) continue;

        const value =
          BigInt(
            Math.round(
              stock.price
            )
          ) *
          BigInt(quantity);

        text +=
`📌 ${name}
보유: ${quantity}주
평가액: ${money(value)}
지분: ${
  sharePercent(
    guildData,
    user,
    name
  ).toFixed(2)
}%

`;
      }

      if (!text) {
        text =
          "보유한 주식이 없습니다.";
      }

      return interaction.reply({
        content:
          `📦 내 주식\n\n${text}`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "stock_list"
    ) {
      return interaction.reply({
        embeds: [
          stockMenuEmbed(
            guildData
          )
        ],
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "stock_rank"
    ) {
      const ranking =
        Object.entries(
          guildData.users
        )
          .map(
            ([id, u]) => ({
              id,
              value:
                stockValue(
                  guildData,
                  u
                )
            })
          )
          .sort(
            (a, b) =>
              a.value > b.value
                ? -1
                : a.value < b.value
                  ? 1
                  : 0
          )
          .slice(0, 10);

      const text =
        ranking.length
          ? ranking
              .map(
                (x, i) =>
                  `${i + 1}. <@${x.id}> — ${money(x.value)}`
              )
              .join("\n")
          : "랭킹 데이터가 없습니다.";

      return interaction.reply({
        content:
          `🏆 주식 자산 랭킹\n\n${text}`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "stock_buy"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        stockTradeModal(
          "modal_stock_buy",
          "💵 일반 주식 매수"
        )
      );
    }

    if (
      interaction.customId ===
      "stock_taxfree_buy"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        stockTradeModal(
          "modal_stock_taxfree_buy",
          "🛡️ 면세 주식 매수"
        )
      );
    }

    if (
      interaction.customId ===
      "stock_sell"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        stockTradeModal(
          "modal_stock_sell",
          "💸 일반 주식 매도"
        )
      );
    }

    if (
      interaction.customId ===
      "stock_taxfree_sell"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        stockTradeModal(
          "modal_stock_taxfree_sell",
          "🛡️ 면세 주식 매도"
        )
      );
    }

    if (
      interaction.customId ===
      "bank_deposit"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        amountModal(
          "modal_bank_deposit",
          "🏦 은행 입금"
        )
      );
    }

    if (
      interaction.customId ===
      "bank_withdraw"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        amountModal(
          "modal_bank_withdraw",
          "🏦 은행 출금"
        )
      );
    }

    if (
      interaction.customId ===
      "bank_savings"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      return interaction.showModal(
        savingsModal()
      );
    }

    if (
      interaction.customId ===
      "bank_savings_list"
    ) {
      return interaction.reply({
        content:
`💳 내 적금

${savingsListText(user)}

금리:
1개월 연 ${SAVINGS_RATES[1]}%
3개월 연 ${SAVINGS_RATES[3]}%`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "bank_transfer"
    ) {
      return interaction.reply({
        content:
          "송금은 `/송금` 명령어를 이용해주세요.",
        ephemeral: true
      });
    }
  }

  /* =========================
     모달
  ========================= */

  if (
    interaction.isModalSubmit()
  ) {
    const user =
      getUser(
        guildId,
        interaction.user.id
      );

    if (
      interaction.customId ===
      "modal_bank_deposit"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      const amount =
        cleanAmount(
          interaction.fields
            .getTextInputValue(
              "amount"
            )
        );

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "올바른 금액을 입력해주세요.",
          ephemeral: true
        });
      }

      if (
        big(user.money) <
        amount
      ) {
        return interaction.reply({
          content:
            "현금이 부족합니다.",
          ephemeral: true
        });
      }

      user.money =
        String(
          big(user.money) -
          amount
        );

      user.bank =
        String(
          big(user.bank) +
          amount
        );

      save();

      await log(
        guildId,
        "🏦 은행 입금",
        `${interaction.user} → ${money(amount)}`
      );

      await updateBankMenu(
        guildId
      );

      return interaction.reply({
        content:
          `🏦 ${money(amount)} 입금 완료`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "modal_bank_withdraw"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      const amount =
        cleanAmount(
          interaction.fields
            .getTextInputValue(
              "amount"
            )
        );

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "올바른 금액을 입력해주세요.",
          ephemeral: true
        });
      }

      if (
        big(user.bank) <
        amount
      ) {
        return interaction.reply({
          content:
            "은행 잔액이 부족합니다.",
          ephemeral: true
        });
      }

      user.bank =
        String(
          big(user.bank) -
          amount
        );

      user.money =
        String(
          big(user.money) +
          amount
        );

      save();

      await log(
        guildId,
        "🏦 은행 출금",
        `${interaction.user} ← ${money(amount)}`
      );

      await updateBankMenu(
        guildId
      );

      return interaction.reply({
        content:
          `🏦 ${money(amount)} 출금 완료`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "savings_modal"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      const amount =
        cleanAmount(
          interaction.fields
            .getTextInputValue(
              "amount"
            )
        );

      const months =
        Number(
          interaction.fields
            .getTextInputValue(
              "months"
            )
        );

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "올바른 금액을 입력해주세요.",
          ephemeral: true
        });
      }

      if (
        ![1, 3].includes(
          months
        )
      ) {
        return interaction.reply({
          content:
            "기간은 1 또는 3만 입력할 수 있습니다.",
          ephemeral: true
        });
      }

      if (
        big(user.money) <
        amount
      ) {
        return interaction.reply({
          content:
            "현금이 부족합니다.",
          ephemeral: true
        });
      }

      const rate =
        SAVINGS_RATES[
          months
        ];

      user.money =
        String(
          big(user.money) -
          amount
        );

      const now =
        Date.now();

      const maturityAt =
        now +
        months *
          30 *
          24 *
          60 *
          60 *
          1000;

      user.savings.push({
        principal:
          String(amount),
        months,
        rate,
        createdAt: now,
        maturityAt
      });

      save();

      await log(
        guildId,
        "💳 적금 가입",
        `${interaction.user}
금액: ${money(amount)}
기간: ${months}개월
금리: 연 ${rate}%`
      );

      return interaction.reply({
        content:
`💳 적금 가입 완료

금액: ${money(amount)}
기간: ${months}개월
금리: 연 ${rate}%`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
        "modal_stock_buy" ||
      interaction.customId ===
        "modal_stock_taxfree_buy" ||
      interaction.customId ===
        "modal_stock_sell" ||
      interaction.customId ===
        "modal_stock_taxfree_sell"
    ) {
      if (
        isPaused(guildData)
      ) {
        return interaction.reply({
          content:
            "🚨 현재 경제 비상정지 상태입니다.",
          ephemeral: true
        });
      }

      const name =
        interaction.fields
          .getTextInputValue(
            "stock"
          )
          .trim();

      const quantity =
        Number(
          interaction.fields
            .getTextInputValue(
              "quantity"
            )
        );

      if (
        !guildData.stocks[name]
      ) {
        return interaction.reply({
          content:
            "존재하지 않는 주식입니다.",
          ephemeral: true
        });
      }

      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity <= 0
      ) {
        return interaction.reply({
          content:
            "수량을 올바르게 입력해주세요.",
          ephemeral: true
        });
      }

      const stock =
        guildData.stocks[name];

      const max =
        stock.type === "small"
          ? SMALL_MAX
          : LARGE_MAX;

      if (
        quantity > max
      ) {
        return interaction.reply({
          content:
            `1회 최대 ${max}주까지 거래할 수 있습니다.`,
          ephemeral: true
        });
      }

      const subtotal =
        BigInt(
          Math.round(
            stock.price
          )
        ) *
        BigInt(quantity);

      const isTaxFree =
        interaction.customId.includes(
          "taxfree"
        );

      const isBuy =
        interaction.customId.includes(
          "buy"
        );

      if (isBuy) {
        const tax =
          isTaxFree
            ? 0n
            : (
                subtotal *
                BigInt(
                  guildData.taxRate
                )
              ) /
              100n;

        const total =
          subtotal + tax;

        const balance =
          isTaxFree
            ? big(
                user.taxFreeMoney
              )
            : big(
                user.money
              );

        const minimum =
          stock.type === "small"
            ? SMALL_MIN
            : LARGE_MIN;

        if (
          subtotal <
          BigInt(minimum)
        ) {
          return interaction.reply({
            content:
              `${
                stock.type ===
                "small"
                  ? "소형"
                  : "대형"
              } 주식 최소 매수금액은 ${money(
                minimum
              )}입니다.`,
            ephemeral: true
          });
        }

        if (
          balance < total
        ) {
          return interaction.reply({
            content:
`잔액 부족
필요: ${money(total)}
보유: ${money(balance)}`,
            ephemeral: true
          });
        }

        if (isTaxFree) {
          user.taxFreeMoney =
            String(
              balance - total
            );
        } else {
          user.money =
            String(
              balance - total
            );
        }

        user.stocks[name] =
          userShares(
            user,
            name
          ) +
          quantity;

        save();

        await log(
          guildId,
          "📈 주식 매수",
          `${interaction.user}
${name} ${quantity}주
주식금액: ${money(subtotal)}
세금: ${money(tax)}
총액: ${money(total)}
방식: ${
  isTaxFree
    ? "면세"
    : "일반"
}`
        );

        await updateStockMenu(
          guildId
        );

        return interaction.reply({
          content:
`📈 매수 완료

${name}: ${quantity}주
주식금액: ${money(subtotal)}
세금: ${money(tax)}
총액: ${money(total)}`,
          ephemeral: true
        });
      }

      const owned =
        userShares(
          user,
          name
        );

      if (
        owned < quantity
      ) {
        return interaction.reply({
          content:
            "보유 주식이 부족합니다.",
          ephemeral: true
        });
      }

      const sellSubtotal =
        BigInt(
          Math.round(
            stock.price
          )
        ) *
        BigInt(quantity);

      const tax =
        isTaxFree
          ? 0n
          : (
              sellSubtotal *
              BigInt(
                guildData.taxRate
              )
            ) /
            100n;

      const receive =
        sellSubtotal - tax;

      user.stocks[name] =
        owned - quantity;

      if (isTaxFree) {
        user.taxFreeMoney =
          String(
            big(
              user.taxFreeMoney
            ) +
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

      await log(
        guildId,
        "📉 주식 매도",
        `${interaction.user}
${name} ${quantity}주
매도금액: ${money(
  sellSubtotal
)}
세금: ${money(tax)}
수령액: ${money(
  receive
)}
방식: ${
  isTaxFree
    ? "면세"
    : "일반"
}`
      );

      await updateStockMenu(
        guildId
      );

      return interaction.reply({
        content:
`📉 매도 완료

${name}: ${quantity}주
매도금액: ${money(
  sellSubtotal
)}
세금: ${money(tax)}
수령액: ${money(
  receive
)}`,
        ephemeral: true
      });
    }
  }

  /* =========================
     슬래시 명령어
  ========================= */

  if (
    !interaction.isChatInputCommand()
  ) {
    return;
  }

  const command =
    interaction.commandName;

  const user =
    getUser(
      guildId,
      interaction.user.id
    );

  /* =========================
     선거
  ========================= */

  if (
    command === "선거시작"
  ) {
    if (
      !isAdmin(interaction)
    ) {
      return interaction.reply({
        content:
          "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const election =
      getElection(guildId);

    if (
      election.active
    ) {
      return interaction.reply({
        content:
          "이미 선거가 진행 중입니다.",
        ephemeral: true
      });
    }

    election.active =
      true;

    election.candidates =
      [];

    election.votes =
      {};

    election.candidateListChannelId =
      null;

    election.candidateListMessageId =
      null;

    await log(
      guildId,
      "🗳️ 선거 시작",
      `${interaction.user}`
    );

    return interaction.reply(
      "🗳️ 선거가 시작되었습니다."
    );
  }

  if (
    command === "후보등록"
  ) {
    if (
      !isAdmin(interaction)
    ) {
      return interaction.reply({
        content:
          "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const election =
      getElection(guildId);

    if (
      !election.active
    ) {
      return interaction.reply({
        content:
          "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    if (
      election.candidates
        .length >= 20
    ) {
      return interaction.reply({
        content:
          "후보는 최대 20명까지 등록할 수 있습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options
        .getString("이름")
        .trim();

    if (
      !name ||
      election.candidates
        .includes(name)
    ) {
      return interaction.reply({
        content:
          "이미 존재하는 후보입니다.",
        ephemeral: true
      });
    }

    election.candidates
      .push(name);

    await updateCandidateList(
      guildId
    );

    await log(
      guildId,
      "🗳️ 후보 등록",
      `${interaction.user}
후보: ${name}`
    );

    return interaction.reply(
      `후보 등록 완료: ${name}`
    );
  }

  if (
    command === "후보목록"
  ) {
    const election =
      getElection(guildId);

    const message =
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              "🗳️ 후보 목록"
            )
            .setDescription(
              electionText(
                election
              )
            )
            .setTimestamp()
        ],
        fetchReply: true
      });

    election
      .candidateListChannelId =
      interaction.channelId;

    election
      .candidateListMessageId =
      message.id;

    return;
  }

  if (
    command === "투표"
  ) {
    const election =
      getElection(guildId);

    if (
      !election.active
    ) {
      return interaction.reply({
        content:
          "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const candidate =
      interaction.options
        .getString("후보")
        .trim();

    if (
      !election.candidates
        .includes(candidate)
    ) {
      return interaction.reply({
        content:
          "존재하지 않는 후보입니다.",
        ephemeral: true
      });
    }

    if (
      election.votes[
        interaction.user.id
      ]
    ) {
      return interaction.reply({
        content:
          "이미 투표했습니다.",
        ephemeral: true
      });
    }

    election.votes[
      interaction.user.id
    ] = candidate;

    await log(
      guildId,
      "🗳️ 투표",
      `${interaction.user}
후보: ${candidate}`
    );

    return interaction.reply({
      content:
        `🗳️ ${candidate} 후보에게 투표했습니다.`,
      ephemeral: true
    });
  }

  if (
    command === "선거종료" ||
    command === "결과"
  ) {
    if (
      command === "선거종료" &&
      !isAdmin(interaction)
    ) {
      return interaction.reply({
        content:
          "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const election =
      getElection(guildId);

    if (
      !election.active
    ) {
      return interaction.reply({
        content:
          "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const counts = {};

    for (
      const candidate of
      election.candidates
    ) {
      counts[candidate] = 0;
    }

    for (
      const candidate of
      Object.values(
        election.votes
      )
    ) {
      if (
        counts[candidate] !=
        null
      ) {
        counts[candidate]++;
      }
    }

    const resultText =
      election.candidates
        .map(
          c =>
            `**${c}** — ${counts[c]}표`
        )
        .join("\n") ||
      "투표 결과가 없습니다.";

    if (
      command === "결과"
    ) {
      return interaction.reply({
        content:
          `🗳️ 선거 결과\n\n${resultText}`,
        ephemeral: true
      });
    }

    election.active =
      false;

    await log(
      guildId,
      "🗳️ 선거 종료",
      resultText
    );

    return interaction.reply({
      content:
        `🗳️ 선거가 종료되었습니다.\n\n${resultText}`
    });
  }

  /* =========================
     돈
  ========================= */

  if (
    command === "돈추가" ||
    command === "돈제거" ||
    command === "면세돈추가" ||
    command === "면세돈제거"
  ) {
    if (
      !isAdmin(interaction)
    ) {
      return interaction.reply({
        content:
          "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const target =
      interaction.options
        .getUser("대상");

    const amount =
      cleanAmount(
        interaction.options
          .getString("금액")
      );

    if (
      amount <= 0n
    ) {
      return interaction.reply({
        content:
          "올바른 금액을 입력해주세요.",
        ephemeral: true
      });
    }

    const targetUser =
      getUser(
        guildId,
        target.id
      );

    const taxFree =
      command.startsWith(
        "면세"
      );

    const adding =
      command.endsWith(
        "추가"
      );

    const key =
      taxFree
        ? "taxFreeMoney"
        : "money";

    const before =
      big(targetUser[key]);

    if (adding) {
      targetUser[key] =
        String(
          before + amount
        );
    } else {
      targetUser[key] =
        String(
          before > amount
            ? before - amount
            : 0n
        );
    }

    save();

    await log(
      guildId,
      adding
        ? "💰 돈 추가"
        : "💸 돈 제거",
      `${interaction.user}
대상: ${target}
금액: ${money(amount)}
종류: ${
  taxFree
    ? "면세돈"
    : "일반돈"
}`
    );

    return reply10(
      interaction,
      `${
        adding
          ? "추가"
          : "제거"
      } 완료
${target}: ${money(
  amount
)}`
    );
  }

  if (
    command === "잔액"
  ) {
    return interaction.reply({
      content:
`👛 ${interaction.user.username} 잔액

💵 현금: ${money(user.money)}
🏦 은행: ${money(user.bank)}
🛡️ 면세돈: ${money(
  user.taxFreeMoney
)}
📈 주식 평가액: ${money(
  stockValue(
    guildData,
    user
  )
)}`,
      ephemeral: true
    });
  }

  /* =========================
     은행
  ========================= */

  if (
    command === "은행"
  ) {
    return interaction.reply({
      embeds: [
        bankMenuEmbed(
          guildData,
          user
        )
      ],
      components:
        bankMenuRows(),
      ephemeral: true
    });
  }

  if (
    command === "은행메뉴"
  ) {
    if (
      !isAdmin(interaction)
    ) {
      return interaction.reply({
        content:
          "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const message =
      await interaction.reply({
        embeds: [
          bankMenuEmbed(
            guildData,
            {
              money: "0",
              bank: "0",
              taxFreeMoney:
                "0"
            }
          ).setDescription(
`🏦 은행 거래 메뉴

💳 적금 금리
1개월: 연 ${
  SAVINGS_RATES[1]
}%
3개월: 연 ${
  SAVINGS_RATES[3]
}%

💰 적금 이자소득세: ${
  SAVINGS_TAX
}%

${
  guildData.economyPaused
    ? "🚨 경제 비상정지"
    : "🟢 거래 가능"
}`
          )
        ],
        components:
          bankMenuRows(),
        fetchReply: true
      });

    guildData
      .bankMenuChannelId =
      interaction.channelId;

    guildData
      .bankMenuMessageId =
      message.id;

    save();

    return;
  }

  if (
    command === "은행입금" ||
    command === "은행출금"
  ) {
    if (
      isPaused(guildData)
    ) {
      return interaction.reply({
        content:
          "🚨 현재 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const amount =
      cleanAmount(
        interaction.options
          .getString("금액")
      );

    if (
      amount <= 0n
    ) {
      return interaction.reply({
        content:
          "올바른 금액을 입력해주세요.",
        ephemeral: true
      });
    }

    if (
      command ===
      "은행입금"
    ) {
      if (
        big(user.money) <
        amount
      ) {
        return interaction.reply({
          content:
            "현금이 부족합니다.",
          ephemeral: true
        });
      }

      user.money =
        String(
          big(user.money) -
          amount
        );

      user.bank =
        String(
          big(user.bank) +
          amount
        );
    } else {
      if (
        big(user.bank) <
        amount
      ) {
        return interaction.reply({
          content:
            "은행 잔액이 부족합니다.",
          ephemeral: true
        });
      }

      user.bank =
        String(
          big(user.bank) -
          amount
        );

      user.money =
        String(
          big(user.money) +
          amount
        );
    }

    save();

    await log(
      guildId,
      command ===
        "은행입금"
        ? "🏦 은행 입금"
        : "🏦 은행 출금",
      `${interaction.user}
${money(amount)}`
    );

    await updateBankMenu(
      guildId
    );

    return reply10(
      interaction,
      `${
        command ===
        "은행입금"
          ? "입금"
          : "출금"
      } 완료: ${money(
        amount
      )}`
    );
  }

  if (
    command === "송금"
  ) {
    if (
      isPaused(guildData)
    ) {
      return interaction.reply({
        content:
          "🚨 현재 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const target =
      interaction.options
        .getUser("대상");

    const amount =
      cleanAmount(
        interaction.options
          .getString("금액")
      );

    if (
      target.id ===
      interaction.user.id
    ) {
      return interaction.reply({
        content:
          "자기 자신에게 송금할 수 없습니다.",
        ephemeral: true
      });
    }

    if (
      amount <= 0n
    ) {
      return interaction.reply({
        content:
          "올바른 금액을 입력해주세요.",
        ephemeral: true
      });
    }

    if (
      big(user.money) <
      amount
    ) {
      return interaction.reply({
        content:
          "현금이 부족합니다.",
        ephemeral: true
      });
    }

    const receiver =
      getUser(
        guildId,
        target.id
      );

    user.money =
      String(
        big(user.money) -
        amount
      );

    receiver.money =
      String(
        big(receiver.money) +
        amount
      );

    save();

    await log(
      guildId,
      "💰 송금",
      `${interaction.user} → ${target}
금액: ${money(amount)}`
    );

    return reply10(
      interaction,
      `💰 ${target.username}에게 ${money(amount)} 송금 완료`
    );
  }

  /* =========================
     적금
  ========================= */

  if (
    command === "적금가입"
  ) {
    if (
      isPaused(guildData)
    ) {
      return interaction.reply({
        content:
          "🚨 현재 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const amount =
      cleanAmount(
        interaction.options
          .getString("금액")
      );

    const months =
      interaction.options
        .getInteger("기간");

    const rate =
      SAVINGS_RATES[
        months
      ];

    if (!rate) {
      return interaction.reply({
        content:
          "지원되는 기간은 1개월, 3개월입니다.",
        ephemeral: true
      });
    }

    if (
      amount <= 0n ||
      big(user.money) <
        amount
    ) {
      return interaction.reply({
        content:
          "현금이 부족합니다.",
        ephemeral: true
      });
    }

    const now =
      Date.now();

    user.money =
      String(
        big(user.money) -
        amount
      );

    user.savings.push({
      principal:
        String(amount),
      months,
      rate,
      createdAt: now,
      maturityAt:
        now +
        months *
          30 *
          24 *
          60 *
          60 *
          1000
    });

    save();

    await log(
      guildId,
      "💳 적금 가입",
      `${interaction.user}
${money(amount)}
${months}개월
연 ${rate}%`
    );

    return reply10(
      interaction,
      `💳 적금 가입 완료
${money(amount)}
${months}개월
연 ${rate}%`
    );
  }

  if (
    command === "적금목록"
  ) {
    return interaction.reply({
      content:
`💳 적금 목록

${savingsListText(user)}

📌 금리
1개월: 연 ${
  SAVINGS_RATES[1]
}%
3개월: 연 ${
  SAVINGS_RATES[3]
}%
이자소득세: ${
  SAVINGS_TAX
}%`,
      ephemeral: true
    });
  }

  if (
    command === "적금해지"
  ) {
    if (
      isPaused(guildData)
    ) {
      return interaction.reply({
        content:
          "🚨 현재 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const index =
      interaction.options
        .getInteger("번호") -
      1;

    if (
      !user.savings[index]
    ) {
      return interaction.reply({
        content:
          "해당 적금이 없습니다.",
        ephemeral: true
      });
    }

    const saving =
      user.savings[index];

    const principal =
      big(
        saving.principal
      );

    const interest =
      (
        principal *
        BigInt(
          Math.round(
            EARLY_CANCEL_RATE *
            100
          )
        ) *
        BigInt(
          saving.months
        )
      ) /
      10000n /
      12n;

    const tax =
      (
        interest *
        154n
      ) /
      1000n;

    const receive =
      principal +
      interest -
      tax;

    user.money =
      String(
        big(user.money) +
        receive
      );

    user.savings.splice(
      index,
      1
    );

    save();

    await log(
      guildId,
      "💳 적금 중도해지",
      `${interaction.user}
원금: ${money(
  principal
)}
수령: ${money(
  receive
)}`
    );

    return reply10(
      interaction,
      `💳 적금 중도해지 완료
수령액: ${money(
  receive
)}`
    );
  }

  if (
    command === "적금만기"
  ) {
    if (
      isPaused(guildData)
    ) {
      return interaction.reply({
        content:
          "🚨 현재 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const now =
      Date.now();

    const matured = [];
    const remain = [];

    for (
      const saving of
      user.savings
    ) {
      if (
        now >=
        saving.maturityAt
      ) {
        matured.push(
          saving
        );
      } else {
        remain.push(
          saving
        );
      }
    }

    if (
      !matured.length
    ) {
      return interaction.reply({
        content:
          "현재 만기된 적금이 없습니다.",
        ephemeral: true
      });
    }

    let totalReceive =
      0n;

    for (
      const saving of
      matured
    ) {
      const principal =
        big(
          saving.principal
        );

      const interest =
        savingsInterest(
          principal,
          saving.months,
          saving.rate
        );

      const tax =
        (
          interest *
          154n
        ) /
        1000n;

      totalReceive +=
        principal +
        interest -
        tax;
    }

    user.savings =
      remain;

    user.money =
      String(
        big(user.money) +
        totalReceive
      );

    save();

    await log(
      guildId,
      "💳 적금 만기",
      `${interaction.user}
수령액: ${money(
  totalReceive
)}`
    );

    return reply10(
      interaction,
      `💳 만기 적금 수령 완료
총 수령액: ${money(
        totalReceive
      )}`
    );
        }
