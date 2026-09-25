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
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    data = { guilds: {} };
  }
}

if (!data.guilds) data.guilds = {};

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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
  if (typeof g.taxRate !== "number") g.taxRate = DEFAULT_TAX_RATE;
  if (typeof g.inflation !== "number") g.inflation = 0;
  if (typeof g.inflationLimit !== "number") g.inflationLimit = 20;
  if (typeof g.economyPaused !== "boolean") g.economyPaused = false;

  if (
    !Array.isArray(g.inflationEmergencySnapshot) &&
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
  return big(value).toLocaleString("ko-KR") + "원";
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

async function log(guildId, title, description) {
  const guildData = getGuild(guildId);

  if (!guildData.logChannelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(
    guildData.logChannelId
  );

  if (!channel || !channel.isTextBased()) return;

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
    .map((name, i) => `${i + 1}. ${name}`)
    .join("\n");
}

async function updateCandidateList(guildId) {
  const election = getElection(guildId);

  if (
    !election.candidateListChannelId ||
    !election.candidateListMessageId
  ) {
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(
    election.candidateListChannelId
  );

  if (!channel || !channel.isTextBased()) return;

  try {
    const message = await channel.messages.fetch(
      election.candidateListMessageId
    );

    await message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗳️ 후보 목록")
          .setDescription(electionText(election))
          .setTimestamp()
      ]
    });
  } catch {}
}

/* =========================
   주식
========================= */

function userShares(user, stockName) {
  return Number(user.stocks?.[stockName] || 0);
}

function totalShares(guildData, stockName) {
  let total = 0;

  for (const user of Object.values(guildData.users)) {
    total += userShares(user, stockName);
  }

  return total;
}

function stockValue(guildData, user) {
  let total = 0n;

  for (const [name, quantity] of Object.entries(
    user.stocks || {}
  )) {
    const stock = guildData.stocks[name];

    if (!stock) continue;

    total +=
      BigInt(Math.max(0, Math.round(stock.price))) *
      BigInt(quantity);
  }

  return total;
}

function sharePercent(guildData, user, stockName) {
  const total = totalShares(guildData, stockName);

  if (total <= 0) return 0;

  return (
    userShares(user, stockName) / total
  ) * 100;
}

function stockMenuEmbed(guildData) {
  let text = "";

  const entries = Object.entries(guildData.stocks);

  if (!entries.length) {
    text = "현재 등록된 주식이 없습니다.";
  } else {
    for (const [name, stock] of entries) {
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

※ 주식 가격은 평일 KRX 장중 시간대에 현실 시장처럼 자동 변동합니다.
`
    )
    .setTimestamp();
}

function stockMenuRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stock_buy")
        .setLabel("💵 일반 매수")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("stock_taxfree_buy")
        .setLabel("🛡️ 면세 매수")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("stock_sell")
        .setLabel("💸 일반 매도")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("stock_taxfree_sell")
        .setLabel("🛡️ 면세 매도")
        .setStyle(ButtonStyle.Secondary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("wallet")
        .setLabel("👛 내 지갑")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("my_stocks")
        .setLabel("📦 내 주식")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_list")
        .setLabel("📋 주식 목록")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_rank")
        .setLabel("🏆 주식 랭킹")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function updateStockMenu(guildId) {
  const guildData = getGuild(guildId);

  if (
    !guildData.stockMenuChannelId ||
    !guildData.stockMenuMessageId
  ) {
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(
    guildData.stockMenuChannelId
  );

  if (!channel || !channel.isTextBased()) return;

  try {
    const message = await channel.messages.fetch(
      guildData.stockMenuMessageId
    );

    await message.edit({
      embeds: [stockMenuEmbed(guildData)],
      components: stockMenuRows()
    });
  } catch {}
}

/* =========================
   은행
========================= */

function bankMenuEmbed(guildData, user) {
  return new EmbedBuilder()
    .setTitle("🏦 은행")
    .setDescription(
`💵 현금: ${money(user.money)}
🏦 은행: ${money(user.bank)}
🛡️ 면세돈: ${money(user.taxFreeMoney)}

━━━━━━━━━━━━━━
💳 적금 금리

1개월: 연 ${SAVINGS_RATES[1]}%
3개월: 연 ${SAVINGS_RATES[3]}%

💰 적금 이자소득세: ${SAVINGS_TAX}%
`
    )
    .setTimestamp();
}

function bankMenuRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("bank_deposit")
        .setLabel("💵 입금")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("bank_withdraw")
        .setLabel("💸 출금")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("bank_transfer")
        .setLabel("💰 송금")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("bank_savings")
        .setLabel("💳 적금")
        .setStyle(ButtonStyle.Success)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("bank_savings_list")
        .setLabel("📋 적금 목록")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("wallet")
        .setLabel("👛 내 지갑")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function updateBankMenu(guildId) {
  const guildData = getGuild(guildId);

  if (
    !guildData.bankMenuChannelId ||
    !guildData.bankMenuMessageId
  ) {
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(
    guildData.bankMenuChannelId
  );

  if (!channel || !channel.isTextBased()) return;

  try {
    const message = await channel.messages.fetch(
      guildData.bankMenuMessageId
    );

    const dummyUser = {
      money: "0",
      bank: "0",
      taxFreeMoney: "0"
    };

    await message.edit({
      embeds: [
        bankMenuEmbed(guildData, dummyUser)
          .setDescription(
`🏦 은행 거래 메뉴

💳 적금 금리
1개월: 연 ${SAVINGS_RATES[1]}%
3개월: 연 ${SAVINGS_RATES[3]}%

💰 적금 이자소득세: ${SAVINGS_TAX}%

${guildData.economyPaused
  ? "🚨 현재 경제 비상정지 상태입니다."
  : "🟢 현재 거래 가능합니다."}`
          )
      ],
      components: bankMenuRows()
    });
  } catch {}
}

/* =========================
   적금
========================= */

function savingsInterest(principal, months, rate) {
  const p = big(principal);

  return (
    p *
    BigInt(Math.round(rate * 100)) *
    BigInt(months)
  ) / 10000n / 12n;
}

function savingsListText(user) {
  if (!user.savings.length) {
    return "가입한 적금이 없습니다.";
  }

  return user.savings
    .map((s, i) =>
`${i + 1}. ${money(s.principal)}
기간: ${s.months}개월
금리: 연 ${s.rate}%
가입일: <t:${Math.floor(s.createdAt / 1000)}:f>
만기: <t:${Math.floor(s.maturityAt / 1000)}:f>`
    )
    .join("\n\n");
}

/* =========================
   경제 스냅샷
========================= */

function economySnapshot(guildData) {
  let cash = 0n;
  let taxFree = 0n;
  let bank = 0n;
  let savings = 0n;
  let stocks = 0n;

  for (const user of Object.values(guildData.users)) {
    cash += big(user.money);
    taxFree += big(user.taxFreeMoney);
    bank += big(user.bank);

    for (const s of user.savings || []) {
      savings += big(s.principal);
    }

    for (const [name, quantity] of Object.entries(
      user.stocks || {}
    )) {
      const stock = guildData.stocks[name];

      if (!stock) continue;

      stocks +=
        BigInt(Math.round(stock.price)) *
        BigInt(quantity);
    }
  }

  const locked = bank + savings + stocks;
  const total = cash + taxFree + bank + savings + stocks;

  return {
    cash: String(cash),
    taxFree: String(taxFree),
    bank: String(bank),
    savings: String(savings),
    stocks: String(stocks),
    locked: String(locked),
    total: String(total)
  };
}

async function triggerInflationEmergency(
  guildId,
  guildData
) {
  if (guildData.economyPaused) return;

  guildData.economyPaused = true;

  const snapshot = economySnapshot(guildData);

  guildData.inflationEmergencySnapshot = snapshot;

  let removedCount = 0;
  const removedLines = [];

  for (const [userId, user] of Object.entries(
    guildData.users
  )) {
    for (const [
      stockName,
      quantity
    ] of Object.entries(user.stocks || {})) {
      const q = Number(quantity || 0);

      if (q <= 0) continue;

      user.stocks[stockName] = q - 1;
      removedCount++;

      removedLines.push(
        `<@${userId}> — ${stockName} -1주`
      );
    }
  }

  save();

  const guild = client.guilds.cache.get(guildId);

  if (!guild || !guildData.logChannelId) return;

  const channel = guild.channels.cache.get(
    guildData.logChannelId
  );

  if (!channel || !channel.isTextBased()) return;

  const roleMention = guildData.economyAdminRoleId
    ? `<@&${guildData.economyAdminRoleId}>`
    : "";

  const removalText = removedCount
    ? removedLines.slice(0, 100).join("\n") +
      (
        removedLines.length > 100
          ? `\n...외 ${removedLines.length - 100}건`
          : ""
      )
    : "차감할 주식이 없습니다.";

  const embed = new EmbedBuilder()
    .setTitle("🚨 인플레이션 경제 비상상황")
    .setDescription(
`📈 인플레이션: ${guildData.inflation}%
🛑 정지 기준: ${guildData.inflationLimit}%

🏦 은행 거래: 정지
💳 적금 거래: 정지
💸 송금: 정지
📈 주식 거래: 정지
🤝 주식 양도: 정지

━━━━━━━━━━━━━━
💥 정지 시점 경제 규모
━━━━━━━━━━━━━━
💵 현금: ${money(snapshot.cash)}
🛡️ 면세돈: ${money(snapshot.taxFree)}
🏦 은행: ${money(snapshot.bank)}
💳 적금 원금: ${money(snapshot.savings)}
📈 주식 평가액: ${money(snapshot.stocks)}

🔒 거래 정지 자산:
${money(snapshot.locked)}

💰 전체 경제 자산:
${money(snapshot.total)}

━━━━━━━━━━━━━━
📉 인플레이션 주식 차감
━━━━━━━━━━━━━━
보유 중인 모든 종목에서
보유자마다 1주씩 자동 차감

총 차감: ${removedCount}주

${removalText}`
    )
    .setTimestamp();

  try {
    await channel.send({
      content: roleMention || undefined,
      embeds: [embed],
      allowedMentions: guildData.economyAdminRoleId
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
   현실 시장 시간
========================= */

function kstNow() {
  const parts =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());

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
  const now = kstNow();

  const weekday = new Date(
    `${String(now.year).padStart(4, "0")}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}T00:00:00+09:00`
  ).getUTCDay();

  if (weekday === 0 || weekday === 6) {
    return false;
  }

  const minutes =
    now.hour * 60 + now.minute;

  return (
    minutes >= 9 * 60 &&
    minutes <= 15 * 60 + 30
  );
}

async function moveStockPrices() {
  if (!isKrxOpen()) return;

  for (
    const [guildId, guildData]
    of Object.entries(data.guilds)
  ) {
    if (!guildData.stocks) continue;

    for (
      const [name, stock]
      of Object.entries(guildData.stocks)
    ) {
      const old = Number(stock.price || 1);

      const random =
        (Math.random() * 1.6) - 0.8;

      const next = Math.max(
        1,
        Math.round(
          old * (1 + random / 100)
        )
      );

      if (next === old) continue;

      stock.price = next;

      await log(
        guildId,
        "📊 주식 가격 변동",
        `${name}\n` +
        `이전: ${old.toLocaleString("ko-KR")}원\n` +
        `현재: ${next.toLocaleString("ko-KR")}원\n` +
        `등락: ${(
          (next - old) /
          old *
          100
        ).toFixed(2)}%`
      );
    }

    save();

    await updateStockMenu(guildId);
  }
}
      if (quantity > max) {
        return interaction.reply({
          content:
            `한 번에 최대 ${max}주까지 거래할 수 있습니다.`,
          ephemeral: true
        });
      }

      const price = BigInt(
        Math.round(stock.price)
      );

      const subtotal =
        price * BigInt(quantity);

      const isTaxFree =
        interaction.customId ===
          "modal_stock_taxfree_buy" ||
        interaction.customId ===
          "modal_stock_taxfree_sell";

      /* =========================
         매수
      ========================= */

      if (
        interaction.customId ===
          "modal_stock_buy" ||
        interaction.customId ===
          "modal_stock_taxfree_buy"
      ) {
        const minPrice =
          stock.type === "small"
            ? SMALL_MIN
            : LARGE_MIN;

        if (
          Number(stock.price) < minPrice
        ) {
          return interaction.reply({
            content:
              `이 주식은 최소 ${minPrice.toLocaleString("ko-KR")}원 이상이어야 합니다.`,
            ephemeral: true
          });
        }

        if (isTaxFree) {
          if (
            big(user.taxFreeMoney) <
            subtotal
          ) {
            return interaction.reply({
              content: "면세돈이 부족합니다.",
              ephemeral: true
            });
          }

          user.taxFreeMoney = String(
            big(user.taxFreeMoney) -
            subtotal
          );
        } else {
          const tax =
            subtotal *
            BigInt(
              Math.round(
                guildData.taxRate * 100
              )
            ) /
            10000n;

          const total =
            subtotal + tax;

          if (
            big(user.money) < total
          ) {
            return interaction.reply({
              content:
                `돈이 부족합니다.\n필요 금액: ${money(total)}`,
              ephemeral: true
            });
          }

          user.money = String(
            big(user.money) - total
          );
        }

        user.stocks[name] =
          userShares(user, name) +
          quantity;

        save();

        await log(
          guildId,
          "📈 주식 매수",
          `${interaction.user}\n` +
          `주식: ${name}\n` +
          `수량: ${quantity}주\n` +
          `금액: ${money(subtotal)}\n` +
          `방식: ${isTaxFree ? "면세" : "일반"}`
        );

        await updateStockMenu(
          guildId
        );

        return reply10(
          interaction,
          `📈 ${name} ${quantity}주 매수 완료\n` +
          `거래금액: ${money(subtotal)}`
        );
      }

      /* =========================
         매도
      ========================= */

      if (
        interaction.customId ===
          "modal_stock_sell" ||
        interaction.customId ===
          "modal_stock_taxfree_sell"
      ) {
        const owned =
          userShares(user, name);

        if (owned < quantity) {
          return interaction.reply({
            content:
              `보유 주식이 부족합니다.\n현재 보유: ${owned}주`,
            ephemeral: true
          });
        }

        if (isTaxFree) {
          user.taxFreeMoney = String(
            big(user.taxFreeMoney) +
            subtotal
          );
        } else {
          const tax =
            subtotal *
            BigInt(
              Math.round(
                guildData.taxRate * 100
              )
            ) /
            10000n;

          const receive =
            subtotal - tax;

          user.money = String(
            big(user.money) + receive
          );
        }

        const remain =
          owned - quantity;

        if (remain <= 0) {
          delete user.stocks[name];
        } else {
          user.stocks[name] =
            remain;
        }

        save();

        await log(
          guildId,
          "📉 주식 매도",
          `${interaction.user}\n` +
          `주식: ${name}\n` +
          `수량: ${quantity}주\n` +
          `거래금액: ${money(subtotal)}\n` +
          `방식: ${isTaxFree ? "면세" : "일반"}`
        );

        await updateStockMenu(
          guildId
        );

        return reply10(
          interaction,
          `📉 ${name} ${quantity}주 매도 완료\n` +
          `거래금액: ${money(subtotal)}`
        );
      }
    }
  }

  /* =========================
     슬래시 명령어
  ========================= */

  if (!interaction.isChatInputCommand()) {
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
     선거 시작
  ========================= */

  if (command === "선거시작") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 선거를 시작할 수 있습니다.",
        ephemeral: true
      });
    }

    const election =
      getElection(guildId);

    if (election.active) {
      return interaction.reply({
        content:
          "이미 진행 중인 선거가 있습니다.",
        ephemeral: true
      });
    }

    election.active = true;
    election.candidates = [];
    election.votes = {};
    election.candidateListChannelId =
      interaction.channelId;

    const message =
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🗳️ 선거 시작")
            .setDescription(
              "후보를 등록해주세요.\n\n" +
              "후보 등록: `/후보등록 이름:`"
            )
            .setTimestamp()
        ],
        fetchReply: true
      });

    election.candidateListMessageId =
      message.id;

    await log(
      guildId,
      "🗳️ 선거 시작",
      `${interaction.user}`
    );

    return;
  }

  /* =========================
     후보 등록
  ========================= */

  if (command === "후보등록") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 후보를 등록할 수 있습니다.",
        ephemeral: true
      });
    }

    const election =
      getElection(guildId);

    if (!election.active) {
      return interaction.reply({
        content:
          "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    if (
      election.candidates.length >=
      20
    ) {
      return interaction.reply({
        content:
          "❌ 후보는 최대 20명까지 등록할 수 있습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options
        .getString("이름")
        .trim();

    if (!name) {
      return interaction.reply({
        content:
          "후보 이름을 입력해주세요.",
        ephemeral: true
      });
    }

    if (
      election.candidates
        .some(
          x => x.toLowerCase() ===
            name.toLowerCase()
        )
    ) {
      return interaction.reply({
        content:
          "이미 등록된 후보입니다.",
        ephemeral: true
      });
    }

    election.candidates.push(
      name
    );

    await updateCandidateList(
      guildId
    );

    await log(
      guildId,
      "📝 후보 등록",
      `${interaction.user}\n후보: ${name}`
    );

    return interaction.reply({
      content:
        `📝 후보 **${name}** 등록 완료`,
      ephemeral: true
    });
  }

  /* =========================
     후보 목록
  ========================= */

  if (command === "후보목록") {
    const election =
      getElection(guildId);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗳️ 후보 목록")
          .setDescription(
            electionText(election)
          )
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  /* =========================
     투표
  ========================= */

  if (command === "투표") {
    const election =
      getElection(guildId);

    if (!election.active) {
      return interaction.reply({
        content:
          "현재 진행 중인 선거가 없습니다.",
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
          "❌ 이미 투표했습니다.",
        ephemeral: true
      });
    }

    const candidate =
      interaction.options
        .getString("후보")
        .trim();

    const found =
      election.candidates.find(
        x =>
          x.toLowerCase() ===
          candidate.toLowerCase()
      );

    if (!found) {
      return interaction.reply({
        content:
          "❌ 존재하지 않는 후보입니다.",
        ephemeral: true
      });
    }

    election.votes[
      interaction.user.id
    ] = found;

    await log(
      guildId,
      "🗳️ 투표",
      `${interaction.user}\n후보: ${found}`
    );

    return reply10(
      interaction,
      `🗳️ **${found}**에게 투표했습니다.`
    );
  }

  /* =========================
     선거 결과 계산
  ========================= */

  function electionResult(
    election
  ) {
    const counts = {};

    for (
      const candidate
      of election.candidates
    ) {
      counts[candidate] = 0;
    }

    for (
      const vote
      of Object.values(
        election.votes
      )
    ) {
      if (
        counts[vote] !== undefined
      ) {
        counts[vote]++;
      }
    }

    return counts;
  }

  /* =========================
     선거 결과
  ========================= */

  if (command === "결과") {
    const election =
      getElection(guildId);

    const counts =
      electionResult(election);

    const text =
      election.candidates.length
        ? election.candidates
            .map(
              name =>
                `**${name}** — ${counts[name] || 0}표`
            )
            .join("\n")
        : "후보가 없습니다.";

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗳️ 선거 결과")
          .setDescription(text)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  /* =========================
     선거 종료
  ========================= */

  if (command === "선거종료") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 선거를 종료할 수 있습니다.",
        ephemeral: true
      });
    }

    const election =
      getElection(guildId);

    if (!election.active) {
      return interaction.reply({
        content:
          "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const counts =
      electionResult(election);

    const resultText =
      election.candidates.length
        ? election.candidates
            .map(
              name =>
                `**${name}** — ${counts[name] || 0}표`
            )
            .join("\n")
        : "후보가 없습니다.";

    election.active = false;

    await log(
      guildId,
      "🏁 선거 종료",
      `${interaction.user}\n\n${resultText}`
    );

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏁 선거 종료")
          .setDescription(resultText)
          .setTimestamp()
      ]
    });
  }

  /* =========================
     돈 추가
  ========================= */

  if (command === "돈추가") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 사용할 수 있습니다.",
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

    if (amount <= 0n) {
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

    targetUser.money =
      String(
        big(targetUser.money) +
        amount
      );

    save();

    await log(
      guildId,
      "💰 돈 추가",
      `${interaction.user}\n` +
      `대상: ${target}\n` +
      `금액: ${money(amount)}`
    );

    return interaction.reply({
      content:
        `💰 ${target}에게 ${money(amount)} 추가`,
      ephemeral: true
    });
  }

  /* =========================
     돈 제거
  ========================= */

  if (command === "돈제거") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 사용할 수 있습니다.",
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

    const targetUser =
      getUser(
        guildId,
        target.id
      );

    const current =
      big(targetUser.money);

    const removed =
      amount > current
        ? current
        : amount;

    targetUser.money =
      String(
        current - removed
      );

    save();

    await log(
      guildId,
      "💸 돈 제거",
      `${interaction.user}\n` +
      `대상: ${target}\n` +
      `금액: ${money(removed)}`
    );

    return interaction.reply({
      content:
        `💸 ${target}에게서 ${money(removed)} 제거`,
      ephemeral: true
    });
  }

  /* =========================
     면세돈 추가
  ========================= */

  if (command === "면세돈추가") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 사용할 수 있습니다.",
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

    if (amount <= 0n) {
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

    targetUser.taxFreeMoney =
      String(
        big(
          targetUser.taxFreeMoney
        ) + amount
      );

    save();

    await log(
      guildId,
      "🛡️ 면세돈 추가",
      `${interaction.user}\n` +
      `대상: ${target}\n` +
      `금액: ${money(amount)}`
    );

    return interaction.reply({
      content:
        `🛡️ ${target}에게 면세돈 ${money(amount)} 추가`,
      ephemeral: true
    });
  }

  /* =========================
     면세돈 제거
  ========================= */

  if (command === "면세돈제거") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 관리자만 사용할 수 있습니다.",
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

    const targetUser =
      getUser(
        guildId,
        target.id
      );

    const current =
      big(
        targetUser.taxFreeMoney
      );

    const removed =
      amount > current
        ? current
        : amount;

    targetUser.taxFreeMoney =
      String(
        current - removed
      );

    save();

    await log(
      guildId,
      "🛡️ 면세돈 제거",
      `${interaction.user}\n` +
      `대상: ${target}\n` +
      `금액: ${money(removed)}`
    );

    return interaction.reply({
      content:
        `🛡️ ${target}의 면세돈 ${money(removed)} 제거`,
      ephemeral: true
    });
  }

  /* =========================
     잔액
  ========================= */

  if (command === "잔액") {
    return interaction.reply({
      content:
`👛 ${interaction.user}님의 잔액

💵 현금: ${money(user.money)}
🏦 은행: ${money(user.bank)}
🛡️ 면세돈: ${money(user.taxFreeMoney)}

📈 주식 평가액: ${money(
  stockValue(guildData, user)
)}`,
      ephemeral: true
    });
  }

  /* =========================
     은행
  ========================= */

  if (command === "은행") {
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

  /* =========================
     은행 입금
  ========================= */

  if (command === "은행입금") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const amount =
      cleanAmount(
        interaction.options
          .getString("금액")
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
      `${interaction.user} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `🏦 ${money(amount)} 입금 완료`,
      ephemeral: true
    });
  }

  /* =========================
     은행 출금
  ========================= */

  if (command === "은행출금") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const amount =
      cleanAmount(
        interaction.options
          .getString("금액")
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
      `${interaction.user} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `🏦 ${money(amount)} 출금 완료`,
      ephemeral: true
    });
  }

  /* =========================
     송금
  ========================= */

  if (command === "송금") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 경제 비상정지 상태입니다.",
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

    const targetUser =
      getUser(
        guildId,
        target.id
      );

    user.money =
      String(
        big(user.money) -
        amount
      );

    targetUser.money =
      String(
        big(targetUser.money) +
        amount
      );

    save();

    await log(
      guildId,
      "💰 송금",
      `${interaction.user} → ${target}\n` +
      `금액: ${money(amount)}`
    );

    return reply10(
      interaction,
      `💰 ${target}에게 ${money(amount)} 송금 완료`
    );
  }

  /* =========================
     적금 가입
  ========================= */

  if (command === "적금가입") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 경제 비상정지 상태입니다.",
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

    if (amount <= 0n) {
      return interaction.reply({
        content:
          "올바른 금액을 입력해주세요.",
        ephemeral: true
      });
    }

    if (
      !SAVINGS_RATES[months]
    ) {
      return interaction.reply({
        content:
          "1개월 또는 3개월만 가능합니다.",
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
      SAVINGS_RATES[months];

    const now = Date.now();

    user.money =
      String(
        big(user.money) -
        amount
      );

    user.savings.push({
      principal: String(amount),
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
      `${interaction.user}\n` +
      `금액: ${money(amount)}\n` +
      `기간: ${months}개월\n` +
      `금리: 연 ${rate}%`
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

  /* =========================
     적금 목록
  ========================= */

  if (command === "적금목록") {
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

  /* =========================
     적금 해지
  ========================= */

  if (command === "적금해지") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const index =
      interaction.options
        .getInteger("번호") - 1;

    if (
      index < 0 ||
      index >= user.savings.length
    ) {
      return interaction.reply({
        content:
          "존재하지 않는 적금 번호입니다.",
        ephemeral: true
      });
    }

    const saving =
      user.savings[index];

    const principal =
      big(saving.principal);

    const interest =
      principal *
      BigInt(
        Math.round(
          EARLY_CANCEL_RATE * 100
        )
      ) /
      10000n *
      BigInt(
        saving.months
      ) /
      12n;

    const receive =
      principal + interest;

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
      `${interaction.user}\n` +
      `원금: ${money(principal)}\n` +
      `수령: ${money(receive)}`
    );

    return interaction.reply({
      content:
`💳 적금 중도해지 완료

원금: ${money(principal)}
수령액: ${money(receive)}

※ 중도해지 금리는 연 ${EARLY_CANCEL_RATE}%로 적용됩니다.`,
      ephemeral: true
    });
  }

  /* =========================
     적금 만기
  ========================= */

  if (command === "적금만기") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 경제 비상정지 상태입니다.",
        ephemeral: true
      });
    }

    const now =
      Date.now();

    const matured =
      user.savings.filter(
        s =>
          now >=
          s.maturityAt
      );

    if (!matured.length) {
      return interaction.reply({
        content:
          "만기된 적금이 없습니다.",
        ephemeral: true
      });
    }

    let totalReceive = 0n;

    for (const saving of matured) {
      const principal =
        big(saving.principal);

      const interest =
        savingsInterest(
          principal,
          saving.months,
          saving.rate
        );

      const tax =
        interest *
        BigInt(
          Math.round(
            SAVINGS_TAX * 100
          )
        ) /
        10000n;

      totalReceive +=
        principal +
        interest -
        tax;
    }

    user.savings =
      user.savings.filter(
        s =>
          now <
          s.maturityAt
      );

    user.money =
      String(
        big(user.money) +
        totalReceive
      );

    save();

    await log(
      guildId,
      "💳 적금 만기",
      `${interaction.user}\n` +
      `수령액: ${money(totalReceive)}`
    );

    return interaction.reply({
      content:
        `💳 만기 적금 ${matured.length}건 수령 완료\n` +
        `수령액: ${money(totalReceive)}`,
      ephemeral: true
    });
  } 
  if (command === "주식참여") {
    return interaction.reply({
      content:
`📈 주식 시스템 이용 가능

현재 등록된 주식: ${Object.keys(guildData.stocks).length}종
세율: ${guildData.taxRate}%

/주식메뉴 명령어로 거래 메뉴를 열 수 있습니다.`,
      ephemeral: true
    });
  }

  if (command === "주식목록") {
    const names = Object.keys(guildData.stocks);

    if (!names.length) {
      return interaction.reply({
        content: "등록된 주식이 없습니다.",
        ephemeral: true
      });
    }

    const text = names.map(name => {
      const stock = guildData.stocks[name];

      return [
        `📌 **${name}**`,
        `가격: ${money(stock.price)}`,
        `종류: ${stock.type === "small" ? "소형" : "대형"}`,
        `회장: ${
          stock.chairmanUserId
            ? `<@${stock.chairmanUserId}>`
            : "미지정"
        }`
      ].join("\n");
    }).join("\n\n");

    return interaction.reply({
      content: `📈 현재 주식 목록\n\n${text}`,
      ephemeral: true
    });
  }

  if (command === "주식메뉴") {
    const message = await interaction.reply({
      embeds: [
        stockMenuEmbed(guildData)
      ],
      components: stockMenuRows(),
      fetchReply: true
    });

    guildData.stockMenuChannelId = interaction.channelId;
    guildData.stockMenuMessageId = message.id;

    save();

    return;
  }

  if (command === "주식랭킹") {
    const users = Object.entries(guildData.users);

    const ranking = users
      .map(([id, u]) => ({
        id,
        value:
          big(u.money) +
          big(u.bank) +
          big(u.taxFreeMoney) +
          BigInt(Math.round(stockValue(guildData, u)))
      }))
      .sort((a, b) => {
        if (a.value > b.value) return -1;
        if (a.value < b.value) return 1;
        return 0;
      })
      .slice(0, 10);

    if (!ranking.length) {
      return interaction.reply({
        content: "랭킹 데이터가 없습니다.",
        ephemeral: true
      });
    }

    const text = ranking
      .map((r, i) =>
        `${i + 1}위 <@${r.id}> — ${money(r.value)}`
      )
      .join("\n");

    return interaction.reply({
      content: `🏆 재산 랭킹\n\n${text}`,
      ephemeral: true
    });
  }

  if (command === "내주식") {
    const names = Object.keys(user.stocks)
      .filter(name => userShares(user, name) > 0);

    if (!names.length) {
      return interaction.reply({
        content: "보유 주식이 없습니다.",
        ephemeral: true
      });
    }

    const text = names.map(name => {
      const stock = guildData.stocks[name];

      if (!stock) return null;

      const shares = userShares(user, name);
      const value =
        BigInt(Math.round(stock.price)) *
        BigInt(shares);

      const totalShares =
        totalSharesForStock(guildData, name);

      const percentage =
        totalShares > 0
          ? ((shares / totalShares) * 100).toFixed(2)
          : "0.00";

      return [
        `📈 **${name}**`,
        `보유: ${shares}주`,
        `평가액: ${money(value)}`,
        `지분율: ${percentage}%`
      ].join("\n");
    }).filter(Boolean).join("\n\n");

    return interaction.reply({
      content: `📊 ${interaction.user.username} 보유 주식\n\n${text}`,
      ephemeral: true
    });
  }

  if (command === "주식가격") {
    const name =
      interaction.options.getString("이름").trim();

    const stock = guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
`📈 ${name}

현재 가격: ${money(stock.price)}
종류: ${stock.type === "small" ? "소형" : "대형"}
회장: ${
  stock.chairmanUserId
    ? `<@${stock.chairmanUserId}>`
    : "미지정"
}`,
      ephemeral: true
    });
  }

  /* =========================
     주식 추가
  ========================= */

  if (command === "주식추가") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름").trim();

    const type =
      interaction.options.getString("종류");

    const price =
      interaction.options.getString("가격");

    if (!name) {
      return interaction.reply({
        content: "주식 이름을 입력해주세요.",
        ephemeral: true
      });
    }

    if (guildData.stocks[name]) {
      return interaction.reply({
        content: "이미 존재하는 주식입니다.",
        ephemeral: true
      });
    }

    const stockCount =
      Object.keys(guildData.stocks).length;

    if (type === "small" && stockCount >= MAX_SMALL_STOCKS) {
      return interaction.reply({
        content: `소형 주식은 최대 ${MAX_SMALL_STOCKS}종까지 등록할 수 있습니다.`,
        ephemeral: true
      });
    }

    const parsedPrice =
      Number(price);

    if (
      !Number.isFinite(parsedPrice) ||
      parsedPrice <= 0
    ) {
      return interaction.reply({
        content: "올바른 가격을 입력해주세요.",
        ephemeral: true
      });
    }

    guildData.stocks[name] = {
      price: Math.round(parsedPrice),
      type:
        type === "large"
          ? "large"
          : "small",
      chairmanUserId: null
    };

    save();

    await updateStockMenu(guildId);

    await log(
      guildId,
      "📈 주식 추가",
      `${interaction.user}\n` +
      `주식: ${name}\n` +
      `가격: ${money(parsedPrice)}\n` +
      `종류: ${type === "large" ? "대형" : "소형"}`
    );

    return reply10(
      interaction,
      `📈 주식 추가 완료\n${name} / ${money(parsedPrice)}`
    );
  }

  /* =========================
     주식 삭제
  ========================= */

  if (command === "주식삭제") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름").trim();

    const stock = guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    const holders =
      Object.values(guildData.users)
        .some(u => userShares(u, name) > 0);

    if (holders) {
      return interaction.reply({
        content:
          "현재 누군가 이 주식을 보유하고 있어 삭제할 수 없습니다.",
        ephemeral: true
      });
    }

    delete guildData.stocks[name];

    save();

    await updateStockMenu(guildId);

    await log(
      guildId,
      "🗑️ 주식 삭제",
      `${interaction.user}\n주식: ${name}`
    );

    return reply10(
      interaction,
      `🗑️ ${name} 주식 삭제 완료`
    );
  }

  /* =========================
     주식 가격 변경
  ========================= */

  if (command === "가격변경") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름").trim();

    const price =
      Number(
        interaction.options.getString("가격")
      );

    const stock =
      guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return interaction.reply({
        content: "올바른 가격을 입력해주세요.",
        ephemeral: true
      });
    }

    const oldPrice =
      stock.price;

    stock.price =
      Math.round(price);

    save();

    await updateStockMenu(guildId);

    await log(
      guildId,
      "💹 주식 가격 변경",
      `${interaction.user}\n` +
      `${name}\n` +
      `${money(oldPrice)} → ${money(stock.price)}`
    );

    return reply10(
      interaction,
      `💹 ${name} 가격 변경 완료\n` +
      `${money(oldPrice)} → ${money(stock.price)}`
    );
  }

  /* =========================
     회장 지정
  ========================= */

  if (command === "회장지정") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름").trim();

    const target =
      interaction.options.getUser("대상");

    const stock =
      guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    stock.chairmanUserId =
      target.id;

    save();

    await log(
      guildId,
      "👔 회사 회장 지정",
      `${interaction.user}\n` +
      `회사: ${name}\n` +
      `회장: ${target}`
    );

    return reply10(
      interaction,
      `👔 ${name}의 회장을 ${target.username}님으로 지정했습니다.`
    );
  }

  /* =========================
     지분 추가
     - 관리자 또는 해당 회사 회장
  ========================= */

  if (command === "지분추가") {
    const name =
      interaction.options.getString("이름").trim();

    const target =
      interaction.options.getUser("대상");

    const quantity =
      interaction.options.getInteger("수량");

    const stock =
      guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    const chairman =
      stock.chairmanUserId === interaction.user.id;

    if (!isAdmin(interaction) && !chairman) {
      return interaction.reply({
        content:
          "관리자 또는 해당 회사 회장만 지분을 추가할 수 있습니다.",
        ephemeral: true
      });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return interaction.reply({
        content: "올바른 수량을 입력해주세요.",
        ephemeral: true
      });
    }

    const targetUser =
      getUser(guildId, target.id);

    targetUser.stocks[name] =
      userShares(targetUser, name) +
      quantity;

    save();

    await updateStockMenu(guildId);

    await log(
      guildId,
      "📊 지분 추가",
      `${interaction.user}\n` +
      `회사: ${name}\n` +
      `대상: ${target}\n` +
      `수량: ${quantity}주`
    );

    return reply10(
      interaction,
      `📊 ${target.username}에게 ${name} ${quantity}주 지분 추가 완료`
    );
  }

  /* =========================
     지분 제거
     - 관리자 또는 해당 회사 회장
  ========================= */

  if (command === "지분제거") {
    const name =
      interaction.options.getString("이름").trim();

    const target =
      interaction.options.getUser("대상");

    const quantity =
      interaction.options.getInteger("수량");

    const stock =
      guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    const chairman =
      stock.chairmanUserId === interaction.user.id;

    if (!isAdmin(interaction) && !chairman) {
      return interaction.reply({
        content:
          "관리자 또는 해당 회사 회장만 지분을 제거할 수 있습니다.",
        ephemeral: true
      });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return interaction.reply({
        content: "올바른 수량을 입력해주세요.",
        ephemeral: true
      });
    }

    const targetUser =
      getUser(guildId, target.id);

    const owned =
      userShares(targetUser, name);

    if (owned < quantity) {
      return interaction.reply({
        content:
          `대상이 보유한 ${name} 지분은 ${owned}주입니다.`,
        ephemeral: true
      });
    }

    targetUser.stocks[name] =
      owned - quantity;

    if (targetUser.stocks[name] <= 0) {
      delete targetUser.stocks[name];
    }

    save();

    await updateStockMenu(guildId);

    await log(
      guildId,
      "📊 지분 제거",
      `${interaction.user}\n` +
      `회사: ${name}\n` +
      `대상: ${target}\n` +
      `수량: ${quantity}주`
    );

    return reply10(
      interaction,
      `📊 ${target.username}의 ${name} ${quantity}주 지분 제거 완료`
    );
  }

  /* =========================
     지분 양도
     - 누구나 사용 가능
  ========================= */

  if (command === "지분양도") {
    if (isPaused(guildData)) {
      return interaction.reply({
        content:
          "🚨 현재 경제 비상정지 상태에서는 지분을 양도할 수 없습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름").trim();

    const target =
      interaction.options.getUser("대상");

    const quantity =
      interaction.options.getInteger("수량");

    const stock =
      guildData.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    if (target.id === interaction.user.id) {
      return interaction.reply({
        content:
          "자기 자신에게 지분을 양도할 수 없습니다.",
        ephemeral: true
      });
    }

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return interaction.reply({
        content: "올바른 수량을 입력해주세요.",
        ephemeral: true
      });
    }

    const senderShares =
      userShares(user, name);

    if (senderShares < quantity) {
      return interaction.reply({
        content:
          `보유 지분이 부족합니다. 현재 ${senderShares}주 보유 중입니다.`,
        ephemeral: true
      });
    }

    const receiver =
      getUser(guildId, target.id);

    user.stocks[name] =
      senderShares - quantity;

    if (user.stocks[name] <= 0) {
      delete user.stocks[name];
    }

    receiver.stocks[name] =
      userShares(receiver, name) +
      quantity;

    save();

    await updateStockMenu(guildId);

    await log(
      guildId,
      "🔄 지분 양도",
      `${interaction.user} → ${target}\n` +
      `회사: ${name}\n` +
      `수량: ${quantity}주`
    );

    return reply10(
      interaction,
      `🔄 ${name} ${quantity}주를 ${target.username}님에게 양도했습니다.`
    );
  }
  /* 세금 */

  if (command === "세금률설정") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const rate =
      interaction.options.getInteger("세율");

    guildData.taxRate = rate;

    save();

    await log(
      guildId,
      "🧾 세금률 변경",
      `${interaction.user}\n세율: ${rate}%`
    );

    await updateStockMenu(guildId);

    return interaction.reply(
      `🧾 거래 세율이 ${rate}%로 변경되었습니다.`
    );
  }

  /* 인플레이션 */

  if (command === "인플레이션설정") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const value =
      interaction.options.getNumber("비율");

    guildData.inflation = value;

    save();

    await log(
      guildId,
      "📊 인플레이션 변경",
      `${interaction.user}\n현재: ${value}%`
    );

    if (
      value >= guildData.inflationLimit &&
      !guildData.economyPaused
    ) {
      await triggerInflationEmergency(
        guildId,
        guildData
      );
    }

    await updateStockMenu(guildId);

    return interaction.reply(
      `📊 인플레이션이 ${value}%로 설정되었습니다.`
    );
  }

  if (command === "인플레이션기준설정") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const value =
      interaction.options.getNumber("비율");

    guildData.inflationLimit = value;

    save();

    await log(
      guildId,
      "🛑 인플레이션 정지 기준 변경",
      `${interaction.user}\n기준: ${value}%`
    );

    if (
      guildData.inflation >= value &&
      !guildData.economyPaused
    ) {
      await triggerInflationEmergency(
        guildId,
        guildData
      );
    }

    return interaction.reply(
      `🛑 경제 정지 기준이 ${value}%로 설정되었습니다.`
    );
  }

  if (command === "경제상태") {
    const snapshot =
      guildData.inflationEmergencySnapshot;

    return interaction.reply({
      content:
`📊 경제 상태

인플레이션: ${guildData.inflation}%
정지 기준: ${guildData.inflationLimit}%

상태:
${guildData.economyPaused ? "🚨 경제 정지" : "🟢 정상"}

${
  snapshot
    ? `정지 시점 거래정지 자산: ${money(snapshot.locked)}`
    : ""
}`,
      ephemeral: true
    });
  }

  if (command === "경제정지해제") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    guildData.economyPaused = false;
    guildData.inflationEmergencySnapshot = null;

    save();

    await log(
      guildId,
      "🟢 경제 정지 해제",
      `${interaction.user}`
    );

    await updateStockMenu(guildId);
    await updateBankMenu(guildId);

    return interaction.reply(
      "🟢 경제 정지가 해제되었습니다."
    );
  }

  if (command === "경제관리자역할") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const role =
      interaction.options.getRole("역할");

    guildData.economyAdminRoleId = role.id;

    save();

    await log(
      guildId,
      "🛡️ 경제 관리자 역할 설정",
      `${interaction.user}\n역할: ${role}`
    );

    return interaction.reply(
      `🛡️ 경제 비상 알림 역할이 ${role}로 지정되었습니다.`
    );
  }

  /* 로그 */

  if (command === "로그채널") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const channel =
      interaction.options.getChannel("채널");

    guildData.logChannelId = channel.id;

    save();

    return interaction.reply(
      `📋 로그 채널이 ${channel}로 설정되었습니다.`
    );
  }

  /* 관리자 메뉴 */

  if (command === "관리자메뉴") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
`⚙️ 관리자 메뉴

💰 /돈추가
💸 /돈제거
🛡️ /면세돈추가
🛡️ /면세돈제거

📈 /주식추가
🗑️ /주식삭제
👔 /회장지정
📊 /주식가격
🧾 /세금률설정

📊 /인플레이션설정
🛑 /인플레이션기준설정
🟢 /경제정지해제
🛡️ /경제관리자역할

📋 /로그채널
🏦 /은행메뉴
📈 /주식메뉴

🗳️ /선거시작
🗳️ /후보등록
🗳️ /선거종료`,
      ephemeral: true
    });
  }
});

/* =========================
   자동 주식 가격
   1분마다 체크
========================= */

setInterval(async () => {
  try {
    await moveStockPrices();
  } catch (err) {
    console.error("주식 자동 변동 오류:", err);
  }
}, 60 * 1000);

/* =========================
   자동 저장
========================= */

setInterval(() => {
  try {
    save();
  } catch {}
}, 30 * 1000);

/* =========================
   로그인
========================= */

client.login(TOKEN);
