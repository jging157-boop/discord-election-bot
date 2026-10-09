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

if (!TOKEN || !CLIENT_ID) {
  throw new Error("DISCORD_TOKEN 또는 CLIENT_ID가 없습니다.");
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

const DATA_FILE = "./stock-data.json";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// ========================
// 기본 설정
// ========================

const MAX_CANDIDATES = 20;

const DEFAULT_TAX_RATE = 20;

const SAVINGS_RATES = {
  1: 2.1,
  3: 3.0
};

const SAVINGS_TAX = 15.4;

const EARLY_CANCEL_RATE = 1.0;

const LOAN_RATE = 10;

const LOAN_MAX_MULTIPLIER = 3;

const INFLATION_DEFAULT_LIMIT = 20;

// ========================
// 데이터
// ========================

let data = {
  guilds: {}
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      data = JSON.parse(raw);
    }
  } catch (err) {
    console.error("데이터 불러오기 실패:", err);
    data = { guilds: {} };
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    console.error("데이터 저장 실패:", err);
  }
}

// ========================
// 서버 데이터
// ========================

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      users: {},
      stocks: {},

      taxRate: DEFAULT_TAX_RATE,

      inflation: 0,
      inflationLimit: INFLATION_DEFAULT_LIMIT,

      economyPaused: false,

      logChannelId: null,

      stockMenuChannelId: null,
      stockMenuMessageId: null,

      bankMenuChannelId: null,
      bankMenuMessageId: null,

      economyAdminRoleId: null,

      inflationEmergencySnapshot: null
    };
  }

  return data.guilds[guildId];
}

// ========================
// 사용자 데이터
// ========================

function getUser(guildId, userId) {
  const guild = getGuild(guildId);

  if (!guild.users[userId]) {
    guild.users[userId] = {
      cash: "0",
      bank: "0",
      taxFree: "0",

      stocks: {},

      savings: [],

      loans: [],

      overdueLoan: "0"
    };
  }

  return guild.users[userId];
}

// ========================
// 금액 처리
// ========================

function toBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function money(value) {
  return toBigInt(value).toLocaleString("ko-KR") + "원";
}

function addMoney(current, amount) {
  return (toBigInt(current) + toBigInt(amount)).toString();
}

function subMoney(current, amount) {
  const result =
    toBigInt(current) - toBigInt(amount);

  return (result < 0n ? 0n : result).toString();
}

function hasMoney(current, amount) {
  return toBigInt(current) >= toBigInt(amount);
}

// ========================
// 관리자 확인
// ========================

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );
}

// ========================
// 로그
// ========================

async function logAction(guild, message) {
  try {
    const g = getGuild(guild.id);

    if (!g.logChannelId) return;

    const channel =
      guild.channels.cache.get(g.logChannelId);

    if (!channel) return;

    await channel.send({
      content: `🧾 ${message}`
    });
  } catch (err) {
    console.error("로그 오류:", err);
  }
}

// ========================
// 서버 접속
// ========================

loadData();

client.once("ready", async () => {
  console.log(`✅ 로그인 완료: ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    getGuild(guild.id);
  }

  saveData();

  console.log("✅ 서버 데이터 준비 완료");
});

client.on("guildCreate", guild => {
  getGuild(guild.id);
  saveData();

  console.log(`➕ 서버 추가: ${guild.name}`);
});

// ========================
// 로그인
// ========================

client.login(TOKEN);
// ========================
// 선거 시스템
// ========================

const elections = new Map();

function getElection(guildId) {
  if (!elections.has(guildId)) {
    elections.set(guildId, {
      active: false,
      candidates: {},
      votes: {}
    });
  }

  return elections.get(guildId);
}

function electionCommands() {
  return [
    new SlashCommandBuilder()
      .setName("선거시작")
      .setDescription("새로운 선거를 시작합니다."),

    new SlashCommandBuilder()
      .setName("후보등록")
      .setDescription("선거 후보를 등록합니다.")
      .addStringOption(option =>
        option
          .setName("이름")
          .setDescription("후보 이름")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("후보목록")
      .setDescription("현재 후보 목록을 봅니다."),

    new SlashCommandBuilder()
      .setName("투표")
      .setDescription("후보에게 투표합니다.")
      .addStringOption(option =>
        option
          .setName("후보")
          .setDescription("투표할 후보 이름")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("선거종료")
      .setDescription("현재 선거를 종료합니다."),

    new SlashCommandBuilder()
      .setName("결과")
      .setDescription("현재 선거 결과를 확인합니다.")
  ];
}

// ========================
// 전체 명령어 목록
// ========================

function commands() {
  return [
    ...electionCommands(),

    new SlashCommandBuilder()
      .setName("잔액")
      .setDescription("내 돈을 확인합니다."),

    new SlashCommandBuilder()
      .setName("주식목록")
      .setDescription("주식 목록을 확인합니다."),

    new SlashCommandBuilder()
      .setName("내주식")
      .setDescription("내 주식을 확인합니다."),

    new SlashCommandBuilder()
      .setName("주식랭킹")
      .setDescription("주식 자산 랭킹을 확인합니다."),

    new SlashCommandBuilder()
      .setName("주식메뉴")
      .setDescription("주식 거래 메뉴를 생성합니다."),

    new SlashCommandBuilder()
      .setName("은행")
      .setDescription("은행 메뉴를 생성합니다.")
  ];
}

// ========================
// 명령어 등록
// ========================

async function registerCommands() {
  try {
    const commandData =
      commands().map(command => command.toJSON());

    // 기존 글로벌 명령어 제거
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [] }
    );

    // 서버별 명령어 등록
    for (const guild of client.guilds.cache.values()) {
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
        `✅ 명령어 등록: ${guild.name}`
      );
    }
  } catch (error) {
    console.error(
      "❌ 명령어 등록 오류:",
      error
    );
  }
}

// ========================
// READY
// ========================

client.once("ready", async () => {
  console.log(
    `✅ 로그인 완료: ${client.user.tag}`
  );

  for (const guild of client.guilds.cache.values()) {
    getGuild(guild.id);
  }

  saveData();

  await registerCommands();

  console.log("✅ 모든 서버 명령어 등록 완료");
});

// ========================
// 선거 명령어 처리
// ========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guild = interaction.guild;

  if (!guild) {
    return interaction.reply({
      content: "❌ 서버에서만 사용할 수 있습니다.",
      ephemeral: true
    });
  }

  const guildId = guild.id;
  const election = getElection(guildId);

  // ------------------------
  // 선거 시작
  // ------------------------

  if (interaction.commandName === "선거시작") {

    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 서버 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    if (election.active) {
      return interaction.reply({
        content: "❌ 이미 진행 중인 선거가 있습니다.",
        ephemeral: true
      });
    }

    election.active = true;
    election.candidates = {};
    election.votes = {};

    await logAction(
      guild,
      `🗳️ 선거 시작 — ${interaction.user.tag}`
    );

    return interaction.reply(
      "🗳️ **선거가 시작되었습니다!**\n\n" +
      "`/후보등록 이름:`으로 후보를 등록해주세요."
    );
  }

  // ------------------------
  // 후보 등록
  // ------------------------

  if (interaction.commandName === "후보등록") {

    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 서버 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    if (!election.active) {
      return interaction.reply({
        content: "❌ 진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름")
        .trim();

    if (!name) {
      return interaction.reply({
        content: "❌ 후보 이름을 입력해주세요.",
        ephemeral: true
      });
    }

    if (Object.keys(election.candidates).length >= MAX_CANDIDATES) {
      return interaction.reply({
        content:
          `❌ 후보는 최대 ${MAX_CANDIDATES}명까지 등록할 수 있습니다.`,
        ephemeral: true
      });
    }

    if (election.candidates[name]) {
      return interaction.reply({
        content: "❌ 이미 등록된 후보입니다.",
        ephemeral: true
      });
    }

    election.candidates[name] = {
      name,
      votes: 0
    };

    await logAction(
      guild,
      `👤 후보 등록 — ${name} — ${interaction.user.tag}`
    );

    return interaction.reply(
      `✅ **${name}** 후보가 등록되었습니다.`
    );
  }

  // ------------------------
  // 후보 목록
  // ------------------------

  if (interaction.commandName === "후보목록") {

    if (!election.active) {
      return interaction.reply({
        content: "❌ 진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const candidates =
      Object.values(election.candidates);

    if (candidates.length === 0) {
      return interaction.reply(
        "📋 아직 등록된 후보가 없습니다."
      );
    }

    const text = candidates
      .map((candidate, index) =>
        `${index + 1}. **${candidate.name}** — ${candidate.votes}표`
      )
      .join("\n");

    return interaction.reply(
      `📋 **후보 목록**\n\n${text}`
    );
  }

  // ------------------------
  // 투표
  // ------------------------

  if (interaction.commandName === "투표") {

    if (!election.active) {
      return interaction.reply({
        content: "❌ 진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const candidateName =
      interaction.options
        .getString("후보")
        .trim();

    const candidate =
      election.candidates[candidateName];

    if (!candidate) {
      return interaction.reply({
        content: "❌ 해당 후보가 없습니다.",
        ephemeral: true
      });
    }

    const userId = interaction.user.id;

    if (election.votes[userId]) {
      return interaction.reply({
        content: "❌ 이미 투표했습니다.",
        ephemeral: true
      });
    }

    election.votes[userId] = candidateName;

    candidate.votes++;

    await logAction(
      guild,
      `🗳️ 투표 — ${interaction.user.tag} → ${candidateName}`
    );

    await interaction.reply({
      content:
        `✅ **${candidateName}** 후보에게 투표했습니다.`,
      ephemeral: true
    });
  }

  // ------------------------
  // 선거 결과
  // ------------------------

  if (interaction.commandName === "결과") {

    if (!election.active) {
      return interaction.reply({
        content: "❌ 진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 서버 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const candidates =
      Object.values(election.candidates);

    if (candidates.length === 0) {
      return interaction.reply({
        content: "❌ 등록된 후보가 없습니다.",
        ephemeral: true
      });
    }

    const sorted =
      [...candidates].sort(
        (a, b) => b.votes - a.votes
      );

    const result = sorted
      .map((candidate, index) =>
        `${index + 1}. **${candidate.name}** — ${candidate.votes}표`
      )
      .join("\n");

    return interaction.reply({
      content:
        `📊 **현재 선거 결과**\n\n${result}`,
      ephemeral: true
    });
  }

  // ------------------------
  // 선거 종료
  // ------------------------

  if (interaction.commandName === "선거종료") {

    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 서버 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    if (!election.active) {
      return interaction.reply({
        content: "❌ 진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const candidates =
      Object.values(election.candidates);

    if (candidates.length === 0) {
      return interaction.reply({
        content: "❌ 등록된 후보가 없습니다.",
        ephemeral: true
      });
    }

    const sorted =
      [...candidates].sort(
        (a, b) => b.votes - a.votes
      );

    const result = sorted
      .map((candidate, index) =>
        `${index + 1}. **${candidate.name}** — ${candidate.votes}표`
      )
      .join("\n");

    election.active = false;

    await logAction(
      guild,
      `🛑 선거 종료 — ${interaction.user.tag}`
    );

    await interaction.reply(
      `🛑 **선거가 종료되었습니다.**\n\n` +
      `📊 **최종 결과**\n\n${result}`
    );

    election.candidates = {};
    election.votes = {};
  }
});
// ========================
// 돈 / 은행 / 적금 / 대출
// ========================

function savingsInterest(principal, months) {
  const rate = SAVINGS_RATES[months] || 0;
  const p = toBigInt(principal);

  // 소수점 없는 원 단위 계산
  return (p * BigInt(Math.round(rate * 100)) / 10000n);
}

function createSavings(amount, months) {
  return {
    principal: String(amount),
    months,
    startedAt: Date.now(),
    maturityAt:
      Date.now() +
      months * 30 * 24 * 60 * 60 * 1000
  };
}

function loanInterest(principal) {
  const p = toBigInt(principal);

  return (
    p *
    BigInt(LOAN_RATE) /
    100n
  );
}

function totalLoan(loan) {
  return (
    toBigInt(loan.principal) +
    toBigInt(loan.interest)
  );
}

// ========================
// 은행 메뉴
// ========================

async function sendBankMenu(channel) {
  const embed = new EmbedBuilder()
    .setTitle("🏦 은행")
    .setDescription(
      "은행 서비스를 이용하세요.\n\n" +
      "💵 입금 · 💸 출금 · 📨 송금\n" +
      "🏦 적금 · 💳 대출\n" +
      "📋 적금 목록 · 📋 대출 현황"
    );

  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("bank_deposit")
        .setLabel("💵 입금")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("bank_withdraw")
        .setLabel("💸 출금")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("bank_balance")
        .setLabel("💰 잔액")
        .setStyle(ButtonStyle.Secondary)
    );

  const row2 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("bank_transfer")
        .setLabel("📨 송금")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("bank_savings_join")
        .setLabel("🏦 적금 가입")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("bank_savings_list")
        .setLabel("📋 적금 목록")
        .setStyle(ButtonStyle.Secondary)
    );

  const row3 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("bank_loan")
        .setLabel("💳 대출")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("bank_loan_status")
        .setLabel("📋 대출 현황")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("bank_loan_pay")
        .setLabel("💸 대출 상환")
        .setStyle(ButtonStyle.Danger)
    );

  await channel.send({
    embeds: [embed],
    components: [
      row1,
      row2,
      row3
    ]
  });
}

// ========================
// 모달 생성
// ========================

function amountModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("금액")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("예: 100000")
          .setRequired(true)
        )
    );
}

function transferModal() {
  return new ModalBuilder()
    .setCustomId("bank_transfer_modal")
    .setTitle("📨 송금")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("target")
          .setLabel("받는 사람의 Discord ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("송금 금액")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function savingsJoinModal() {
  return new ModalBuilder()
    .setCustomId("savings_join_modal")
    .setTitle("🏦 적금 가입")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("가입 금액")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("months")
          .setLabel("기간 (1 또는 3개월)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ========================
// 대출 자동 회수
// ========================

async function collectLoanDebt(
  guild,
  userId,
  requiredAmount
) {
  const user = getUser(guild.id, userId);

  let remaining =
    toBigInt(requiredAmount);

  let collected = 0n;

  // ------------------------
  // 1. 현금
  // ------------------------

  const cash =
    toBigInt(user.cash);

  const cashTake =
    cash >= remaining
      ? remaining
      : cash;

  if (cashTake > 0n) {
    user.cash =
      (cash - cashTake).toString();

    remaining -= cashTake;
    collected += cashTake;
  }

  // ------------------------
  // 2. 은행
  // ------------------------

  if (remaining > 0n) {
    const bank =
      toBigInt(user.bank);

    const bankTake =
      bank >= remaining
        ? remaining
        : bank;

    if (bankTake > 0n) {
      user.bank =
        (bank - bankTake).toString();

      remaining -= bankTake;
      collected += bankTake;
    }
  }

  // ------------------------
  // 3. 주식 자동매각
  // ------------------------

  if (remaining > 0n) {
    const guildData =
      getGuild(guild.id);

    for (const stockName of Object.keys(user.stocks)) {
      if (remaining <= 0n) break;

      const quantity =
        Number(user.stocks[stockName] || 0);

      const stock =
        guildData.stocks[stockName];

      if (!stock || quantity <= 0) continue;

      const price =
        Math.max(
          0,
          Math.floor(Number(stock.price))
        );

      if (price <= 0) continue;

      let sellCount =
        Math.min(
          quantity,
          Math.ceil(
            Number(remaining) / price
          )
        );

      if (sellCount <= 0) continue;

      const value =
        BigInt(sellCount) *
        BigInt(price);

      const actualTake =
        value >= remaining
          ? remaining
          : value;

      const sharesNeeded =
        Number(
          (actualTake +
            BigInt(price) -
            1n) /
          BigInt(price)
        );

      sellCount =
        Math.min(
          quantity,
          Math.max(1, sharesNeeded)
        );

      const finalValue =
        BigInt(sellCount) *
        BigInt(price);

      user.stocks[stockName] =
        quantity - sellCount;

      if (user.stocks[stockName] <= 0) {
        delete user.stocks[stockName];
      }

      const take =
        finalValue >= remaining
          ? remaining
          : finalValue;

      remaining -= take;
      collected += take;

      await logAction(
        guild,
        `💳 대출 자동회수 — ${userId} — ${stockName} ${sellCount}주 — ${money(take)}`
      );
    }
  }

  // ------------------------
  // 4. 지분 자동회수
  // ------------------------

  if (remaining > 0n) {
    const guildData =
      getGuild(guild.id);

    for (const stockName of Object.keys(user.stocks)) {
      if (remaining <= 0n) break;

      const stock =
        guildData.stocks[stockName];

      if (!stock) continue;

      const quantity =
        Number(user.stocks[stockName] || 0);

      if (quantity <= 0) continue;

      const price =
        Math.max(
          0,
          Math.floor(Number(stock.price))
        );

      if (price <= 0) continue;

      const takeValue =
        BigInt(
          Math.min(
            quantity,
            Math.ceil(
              Number(remaining) / price
            )
          )
        ) *
        BigInt(price);

      const shares =
        Number(
          (remaining +
            BigInt(price) -
            1n) /
          BigInt(price)
        );

      const removeCount =
        Math.min(
          quantity,
          Math.max(1, shares)
        );

      user.stocks[stockName] =
        quantity - removeCount;

      if (user.stocks[stockName] <= 0) {
        delete user.stocks[stockName];
      }

      const take =
        takeValue >= remaining
          ? remaining
          : takeValue;

      remaining -= take;
      collected += take;

      await logAction(
        guild,
        `🏢 지분/주식 자동회수 — ${userId} — ${stockName} ${removeCount}주 — ${money(take)}`
      );
    }
  }

  saveData();

  return {
    collected: collected.toString(),
    remaining: remaining.toString()
  };
}

// ========================
// 버튼 처리
// ========================

client.on("interactionCreate", async interaction => {

  if (!interaction.isButton()) return;

  const guild =
    interaction.guild;

  if (!guild) return;

  const user =
    getUser(
      guild.id,
      interaction.user.id
    );

  // ------------------------
  // 잔액
  // ------------------------

  if (interaction.customId === "bank_balance") {

    return interaction.reply({
      content:
        `💰 현금: ${money(user.cash)}\n` +
        `🏦 은행: ${money(user.bank)}\n` +
        `🟢 면세돈: ${money(user.taxFree)}`,
      ephemeral: true
    });
  }

  // ------------------------
  // 입금
  // ------------------------

  if (interaction.customId === "bank_deposit") {

    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    return interaction.showModal(
      amountModal(
        "bank_deposit_modal",
        "💵 은행 입금"
      )
    );
  }

  // ------------------------
  // 출금
  // ------------------------

  if (interaction.customId === "bank_withdraw") {

    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    return interaction.showModal(
      amountModal(
        "bank_withdraw_modal",
        "💸 은행 출금"
      )
    );
  }

  // ------------------------
  // 송금
  // ------------------------

  if (interaction.customId === "bank_transfer") {

    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    return interaction.showModal(
      transferModal()
    );
  }

  // ------------------------
  // 적금 가입
  // ------------------------

  if (
    interaction.customId ===
    "bank_savings_join"
  ) {

    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    return interaction.showModal(
      savingsJoinModal()
    );
  }

  // ------------------------
  // 대출
  // ------------------------

  if (interaction.customId === "bank_loan") {

    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    const totalAssets =
      toBigInt(user.cash) +
      toBigInt(user.bank);

    const maxLoan =
      totalAssets *
      BigInt(LOAN_MAX_MULTIPLIER);

    if (maxLoan <= 0n) {
      return interaction.reply({
        content:
          "❌ 현재 대출 한도가 없습니다.\n" +
          `대출 한도: 보유 현금+은행 잔액 × ${LOAN_MAX_MULTIPLIER}`,
        ephemeral: true
      });
    }

    const modal =
      new ModalBuilder()
        .setCustomId("loan_apply_modal")
        .setTitle("💳 대출 신청")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("amount")
              .setLabel(
                `대출 금액 (최대 ${maxLoan.toLocaleString()}원)`
              )
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

    return interaction.showModal(modal);
  }

  // ------------------------
  // 대출 현황
  // ------------------------

  if (
    interaction.customId ===
    "bank_loan_status"
  ) {

    if (user.loans.length === 0) {
      return interaction.reply({
        content: "💳 현재 대출이 없습니다.",
        ephemeral: true
      });
    }

    const text =
      user.loans
        .map((loan, i) =>
          `${i + 1}. 원금 ${money(loan.principal)} / ` +
          `이자 ${money(loan.interest)} / ` +
          `총 ${money(totalLoan(loan))}\n` +
          `만기: <t:${Math.floor(
            loan.dueAt / 1000
          )}:F>`
        )
        .join("\n\n");

    return interaction.reply({
      content:
        `💳 **대출 현황**\n\n${text}\n\n` +
        `⚠️ 연체금: ${money(user.overdueLoan)}`,
      ephemeral: true
    });
  }

  // ------------------------
  // 대출 상환
  // ------------------------

  if (
    interaction.customId ===
    "bank_loan_pay"
  ) {

    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    return interaction.showModal(
      amountModal(
        "loan_payment_modal",
        "💸 대출 상환"
      )
    );
  }
});

// ========================
// 모달 처리
// ========================

client.on("interactionCreate", async interaction => {

  if (!interaction.isModalSubmit()) return;

  const guild =
    interaction.guild;

  if (!guild) return;

  const user =
    getUser(
      guild.id,
      interaction.user.id
    );

  // ------------------------
  // 입금
  // ------------------------

  if (
    interaction.customId ===
    "bank_deposit_modal"
  ) {

    const amount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 올바른 금액을 입력하세요.",
        ephemeral: true
      });
    }

    if (!hasMoney(user.cash, amount)) {
      return interaction.reply({
        content: "❌ 현금이 부족합니다.",
        ephemeral: true
      });
    }

    user.cash =
      subMoney(user.cash, amount);

    user.bank =
      addMoney(user.bank, amount);

    saveData();

    await logAction(
      guild,
      `🏦 은행 입금 — ${interaction.user.tag} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `✅ ${money(amount)} 입금 완료`,
      ephemeral: true
    });
  }

  // ------------------------
  // 출금
  // ------------------------

  if (
    interaction.customId ===
    "bank_withdraw_modal"
  ) {

    const amount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 올바른 금액을 입력하세요.",
        ephemeral: true
      });
    }

    if (!hasMoney(user.bank, amount)) {
      return interaction.reply({
        content: "❌ 은행 잔액이 부족합니다.",
        ephemeral: true
      });
    }

    user.bank =
      subMoney(user.bank, amount);

    user.cash =
      addMoney(user.cash, amount);

    saveData();

    await logAction(
      guild,
      `🏦 은행 출금 — ${interaction.user.tag} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `✅ ${money(amount)} 출금 완료`,
      ephemeral: true
    });
  }

  // ------------------------
  // 송금
  // ------------------------

  if (
    interaction.customId ===
    "bank_transfer_modal"
  ) {

    const targetId =
      interaction.fields
        .getTextInputValue("target")
        .trim();

    const amount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 올바른 금액을 입력하세요.",
        ephemeral: true
      });
    }

    if (!hasMoney(user.cash, amount)) {
      return interaction.reply({
        content: "❌ 현금이 부족합니다.",
        ephemeral: true
      });
    }

    const target =
      await guild.members
        .fetch(targetId)
        .catch(() => null);

    if (!target) {
      return interaction.reply({
        content: "❌ 해당 사용자를 찾을 수 없습니다.",
        ephemeral: true
      });
    }

    if (target.user.bot) {
      return interaction.reply({
        content: "❌ 봇에게 송금할 수 없습니다.",
        ephemeral: true
      });
    }

    const targetUser =
      getUser(
        guild.id,
        target.id
      );

    user.cash =
      subMoney(user.cash, amount);

    targetUser.cash =
      addMoney(
        targetUser.cash,
        amount
      );

    saveData();

    await logAction(
      guild,
      `💸 송금 — ${interaction.user.tag} → ${target.user.tag} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `✅ ${target.user.tag}님에게 ${money(amount)} 송금했습니다.`,
      ephemeral: true
    });
  }

  // ------------------------
  // 적금 가입
  // ------------------------

  if (
    interaction.customId ===
    "savings_join_modal"
  ) {

    const amount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    const months =
      Number(
        interaction.fields
          .getTextInputValue("months")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 올바른 금액을 입력하세요.",
        ephemeral: true
      });
    }

    if (![1, 3].includes(months)) {
      return interaction.reply({
        content:
          "❌ 기간은 1개월 또는 3개월만 가능합니다.",
        ephemeral: true
      });
    }

    if (!hasMoney(user.bank, amount)) {
      return interaction.reply({
        content:
          "❌ 은행 잔액이 부족합니다.",
        ephemeral: true
      });
    }

    user.bank =
      subMoney(user.bank, amount);

    user.savings.push(
      createSavings(
        amount.toString(),
        months
      )
    );

    saveData();

    await logAction(
      guild,
      `🏦 적금 가입 — ${interaction.user.tag} — ${money(amount)} — ${months}개월`
    );

    return interaction.reply({
      content:
        `✅ ${money(amount)} 적금 가입 완료\n` +
        `기간: ${months}개월\n` +
        `금리: ${SAVINGS_RATES[months]}%`,
      ephemeral: true
    });
  }

  // ------------------------
  // 대출 신청
  // ------------------------

  if (
    interaction.customId ===
    "loan_apply_modal"
  ) {

    const amount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 올바른 금액을 입력하세요.",
        ephemeral: true
      });
    }

    const totalAssets =
      toBigInt(user.cash) +
      toBigInt(user.bank);

    const maxLoan =
      totalAssets *
      BigInt(LOAN_MAX_MULTIPLIER);

    if (amount > maxLoan) {
      return interaction.reply({
        content:
          `❌ 대출 한도를 초과했습니다.\n` +
          `최대: ${money(maxLoan)}`,
        ephemeral: true
      });
    }

    const interest =
      loanInterest(amount);

    const loan = {
      principal: amount.toString(),
      interest: interest.toString(),
      startedAt: Date.now(),
      dueAt:
        Date.now() +
        30 * 24 * 60 * 60 * 1000
    };

    user.loans.push(loan);

    user.cash =
      addMoney(user.cash, amount);

    saveData();

    await logAction(
      guild,
      `💳 대출 실행 — ${interaction.user.tag} — ${money(amount)} — 이자 ${money(interest)}`
    );

    return interaction.reply({
      content:
        `✅ 대출 실행 완료\n\n` +
        `💰 대출금: ${money(amount)}\n` +
        `📈 이자: ${money(interest)}\n` +
        `💳 총 상환액: ${money(totalLoan(loan))}\n` +
        `📅 만기: <t:${Math.floor(
          loan.dueAt / 1000
        )}:F>`,
      ephemeral: true
    });
  }

  // ------------------------
  // 대출 상환
  // ------------------------

  if (
    interaction.customId ===
    "loan_payment_modal"
  ) {

    let amount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 올바른 금액을 입력하세요.",
        ephemeral: true
      });
    }

    if (!hasMoney(user.cash, amount)) {
      return interaction.reply({
        content: "❌ 현금이 부족합니다.",
        ephemeral: true
      });
    }

    // 연체금부터 상환
    const overdue =
      toBigInt(user.overdueLoan);

    const overduePay =
      amount >= overdue
        ? overdue
        : amount;

    if (overduePay > 0n) {
      user.overdueLoan =
        (overdue - overduePay).toString();

      amount -= overduePay;
    }

    // 일반 대출 상환
    for (const loan of user.loans) {

      if (amount <= 0n) break;

      const debt =
        totalLoan(loan);

      const pay =
        amount >= debt
          ? debt
          : amount;

      let remainPay = pay;

      const interest =
        toBigInt(loan.interest);

      const interestPay =
        remainPay >= interest
          ? interest
          : remainPay;

      loan.interest =
        (interest - interestPay).toString();

      remainPay -= interestPay;

      const principal =
        toBigInt(loan.principal);

      const principalPay =
        remainPay >= principal
          ? principal
          : remainPay;

      loan.principal =
        (principal - principalPay).toString();

      amount -= pay;

      if (
        toBigInt(loan.principal) <= 0n &&
        toBigInt(loan.interest) <= 0n
      ) {
        const index =
          user.loans.indexOf(loan);

        user.loans.splice(
          index,
          1
        );
      }
    }

    const originalAmount =
      toBigInt(
        interaction.fields
          .getTextInputValue("amount")
      );

    user.cash =
      subMoney(
        user.cash,
        originalAmount
      );

    saveData();

    await logAction(
      guild,
      `💸 대출 상환 — ${interaction.user.tag} — ${money(originalAmount)}`
    );

    return interaction.reply({
      content:
        `✅ ${money(originalAmount)} 상환했습니다.`,
      ephemeral: true
    });
  }
});
// ========================
// 주식 시스템
// ========================

function stockPrice(stock) {
  return Math.max(1, Math.floor(Number(stock.price)));
}

function totalShares(stock) {
  return Object.values(stock.holders || {})
    .reduce((sum, n) => sum + Number(n || 0), 0);
}

function getShares(user, stockName) {
  return Number(user.stocks[stockName] || 0);
}

function setShares(user, stockName, amount) {
  amount = Number(amount);

  if (amount <= 0) {
    delete user.stocks[stockName];
  } else {
    user.stocks[stockName] = amount;
  }
}

function createStock(name, price, type = "small") {
  return {
    name,
    price: Number(price),
    type,
    chairmanUserId: null,
    holders: {}
  };
}

// ========================
// 주식 메뉴
// ========================

async function sendStockMenu(channel, guildId) {
  const g = getGuild(guildId);

  const stockText =
    Object.values(g.stocks).length === 0
      ? "현재 등록된 주식이 없습니다."
      : Object.values(g.stocks)
          .map(s =>
            `• **${s.name}** — ${stockPrice(s).toLocaleString("ko-KR")}원`
          )
          .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("📈 주식 거래소")
    .setDescription(
      `${stockText}\n\n` +
      "아래 버튼으로 주식 거래를 이용하세요."
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("stock_buy")
      .setLabel("💵 일반돈 매수")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("stock_taxfree_buy")
      .setLabel("🟢 면세돈 매수")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("stock_sell")
      .setLabel("💸 일반돈 매도")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("stock_taxfree_sell")
      .setLabel("🟠 면세매도")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("stock_wallet")
      .setLabel("💰 내 지갑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("stock_mystocks")
      .setLabel("📊 내 주식")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("stock_list")
      .setLabel("📋 주식 목록")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("stock_ranking")
      .setLabel("🏆 주식 랭킹")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    embeds: [embed],
    components: [row1, row2]
  });
}

// ========================
// 주식 거래 모달
// ========================

function stockTradeModal(id, title) {
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("stockName")
          .setLabel("주식 이름")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("quantity")
          .setLabel("수량")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

// ========================
// 주식 버튼
// ========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const user = getUser(
    guild.id,
    interaction.user.id
  );

  if (
    interaction.customId === "stock_buy" ||
    interaction.customId === "stock_taxfree_buy"
  ) {
    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    const modal = stockTradeModal(
      interaction.customId === "stock_buy"
        ? "stock_buy_modal"
        : "stock_taxfree_buy_modal",
      interaction.customId === "stock_buy"
        ? "💵 일반돈 매수"
        : "🟢 면세돈 매수"
    );

    return interaction.showModal(modal);
  }

  if (
    interaction.customId === "stock_sell" ||
    interaction.customId === "stock_taxfree_sell"
  ) {
    if (getGuild(guild.id).economyPaused) {
      return interaction.reply({
        content: "⛔ 현재 경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    const modal = stockTradeModal(
      interaction.customId === "stock_sell"
        ? "stock_sell_modal"
        : "stock_taxfree_sell_modal",
      interaction.customId === "stock_sell"
        ? "💸 일반돈 매도"
        : "🟠 면세매도"
    );

    return interaction.showModal(modal);
  }

  if (interaction.customId === "stock_wallet") {
    return interaction.reply({
      content:
        `💰 현금: ${money(user.cash)}\n` +
        `🏦 은행: ${money(user.bank)}\n` +
        `🟢 면세돈: ${money(user.taxFree)}`,
      ephemeral: true
    });
  }

  if (interaction.customId === "stock_mystocks") {
    const stocks = Object.entries(user.stocks);

    if (!stocks.length) {
      return interaction.reply({
        content: "📊 보유 주식이 없습니다.",
        ephemeral: true
      });
    }

    const text = stocks.map(([name, qty]) => {
      const stock = getGuild(guild.id).stocks[name];

      if (!stock) {
        return `• ${name}: ${qty}주`;
      }

      const value =
        BigInt(qty) *
        BigInt(stockPrice(stock));

      const total =
        totalShares(stock);

      const percent =
        total > 0
          ? ((qty / total) * 100).toFixed(2)
          : "0.00";

      return (
        `• **${name}** — ${qty}주\n` +
        `  평가액: ${money(value)}\n` +
        `  지분율: ${percent}%`
      );
    }).join("\n");

    return interaction.reply({
      content: `📊 **내 주식**\n\n${text}`,
      ephemeral: true
    });
  }

  if (interaction.customId === "stock_list") {
    const stocks =
      Object.values(getGuild(guild.id).stocks);

    if (!stocks.length) {
      return interaction.reply({
        content: "📋 등록된 주식이 없습니다.",
        ephemeral: true
      });
    }

    const text = stocks.map(stock =>
      `• **${stock.name}** — ${stockPrice(stock).toLocaleString("ko-KR")}원\n` +
      `  종류: ${stock.type}\n` +
      `  총 발행주식: ${totalShares(stock)}주`
    ).join("\n\n");

    return interaction.reply({
      content: `📋 **주식 목록**\n\n${text}`,
      ephemeral: true
    });
  }

  if (interaction.customId === "stock_ranking") {
    const guildData = getGuild(guild.id);

    const ranking = Object.entries(guildData.users)
      .map(([userId, u]) => {
        let value = toBigInt(u.cash) + toBigInt(u.bank);

        for (const [name, qty] of Object.entries(u.stocks)) {
          const stock = guildData.stocks[name];

          if (stock) {
            value +=
              BigInt(qty) *
              BigInt(stockPrice(stock));
          }
        }

        return {
          userId,
          value
        };
      })
      .sort((a, b) =>
        a.value > b.value ? -1 : 1
      )
      .slice(0, 10);

    const text = ranking.map((r, i) =>
      `${i + 1}. <@${r.userId}> — ${money(r.value)}`
    ).join("\n");

    return interaction.reply({
      content:
        `🏆 **주식/경제 자산 랭킹**\n\n${text || "데이터 없음"}`,
      ephemeral: true
    });
  }
});

// ========================
// 주식 거래
// ========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const guildData = getGuild(guild.id);
  const user = getUser(
    guild.id,
    interaction.user.id
  );

  const buy =
    interaction.customId === "stock_buy_modal" ||
    interaction.customId === "stock_taxfree_buy_modal";

  const sell =
    interaction.customId === "stock_sell_modal" ||
    interaction.customId === "stock_taxfree_sell_modal";

  if (!buy && !sell) return;

  const taxFree =
    interaction.customId.includes("taxfree");

  const stockName =
    interaction.fields
      .getTextInputValue("stockName")
      .trim();

  const quantity =
    Number(
      interaction.fields
        .getTextInputValue("quantity")
    );

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return interaction.reply({
      content: "❌ 수량을 올바르게 입력하세요.",
      ephemeral: true
    });
  }

  const stock =
    guildData.stocks[stockName];

  if (!stock) {
    return interaction.reply({
      content: "❌ 존재하지 않는 주식입니다.",
      ephemeral: true
    });
  }

  const price =
    stockPrice(stock);

  // ========================
  // 매수
  // ========================

  if (buy) {
    const subtotal =
      BigInt(price) *
      BigInt(quantity);

    const tax =
      taxFree
        ? 0n
        : subtotal *
          BigInt(guildData.taxRate) /
          100n;

    const total =
      subtotal + tax;

    const balance =
      taxFree
        ? user.taxFree
        : user.cash;

    if (!hasMoney(balance, total)) {
      return interaction.reply({
        content:
          `❌ 잔액이 부족합니다.\n` +
          `필요 금액: ${money(total)}`,
        ephemeral: true
      });
    }

    if (taxFree) {
      user.taxFree =
        subMoney(user.taxFree, total);
    } else {
      user.cash =
        subMoney(user.cash, total);
    }

    setShares(
      user,
      stockName,
      getShares(user, stockName) + quantity
    );

    stock.holders[interaction.user.id] =
      getShares(user, stockName);

    saveData();

    await logAction(
      guild,
      `📈 매수 — ${interaction.user.tag} — ${stockName} ${quantity}주 — ${money(total)}`
    );

    return interaction.reply({
      content:
        `✅ ${stockName} ${quantity}주 매수 완료\n` +
        `💰 결제 금액: ${money(total)}`,
      ephemeral: true
    });
  }

  // ========================
  // 매도
  // ========================

  if (sell) {
    const owned =
      getShares(user, stockName);

    if (owned < quantity) {
      return interaction.reply({
        content:
          `❌ 보유 수량이 부족합니다.\n` +
          `보유: ${owned}주`,
        ephemeral: true
      });
    }

    const subtotal =
      BigInt(price) *
      BigInt(quantity);

    const tax =
      taxFree
        ? 0n
        : subtotal *
          BigInt(guildData.taxRate) /
          100n;

    const receive =
      subtotal - tax;

    setShares(
      user,
      stockName,
      owned - quantity
    );

    stock.holders[interaction.user.id] =
      getShares(user, stockName);

    if (taxFree) {
      user.taxFree =
        addMoney(user.taxFree, receive);
    } else {
      user.cash =
        addMoney(user.cash, receive);
    }

    saveData();

    await logAction(
      guild,
      `📉 매도 — ${interaction.user.tag} — ${stockName} ${quantity}주 — ${money(receive)}`
    );

    return interaction.reply({
      content:
        `✅ ${stockName} ${quantity}주 매도 완료\n` +
        `💰 받은 금액: ${money(receive)}`,
      ephemeral: true
    });
  }
});

// ========================
// 대출 만기 자동회수
// ========================

async function processLoanMaturities() {
  for (const guild of client.guilds.cache.values()) {
    const guildData = getGuild(guild.id);

    for (const [userId, user] of Object.entries(guildData.users)) {

      for (let i = user.loans.length - 1; i >= 0; i--) {
        const loan = user.loans[i];

        if (Date.now() < loan.dueAt) {
          continue;
        }

        const debt =
          totalLoan(loan);

        const result =
          await collectLoanDebt(
            guild,
            userId,
            debt
          );

        if (toBigInt(result.remaining) <= 0n) {
          user.loans.splice(i, 1);

          await logAction(
            guild,
            `💳 대출 만기 자동회수 완료 — <@${userId}> — ${money(debt)}`
          );
        } else {
          user.loans.splice(i, 1);

          user.overdueLoan =
            addMoney(
              user.overdueLoan,
              result.remaining
            );

          await logAction(
            guild,
            `⚠️ 대출 연체 — <@${userId}> — 미회수 ${money(result.remaining)}`
          );
        }
      }
    }
  }

  saveData();
}

// 1분마다 대출 만기 확인
setInterval(
  processLoanMaturities,
  60 * 1000
);
// ========================
// 관리자 명령어
// ========================

function adminCommands() {
  return [

    // 돈
    new SlashCommandBuilder()
      .setName("돈추가")
      .setDescription("유저에게 일반 돈을 추가합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setDescription("대상")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("금액")
          .setDescription("금액")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("돈제거")
      .setDescription("유저의 일반 돈을 제거합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("금액")
          .setRequired(true)),

    // 면세돈
    new SlashCommandBuilder()
      .setName("면세돈추가")
      .setDescription("면세돈을 추가합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("금액")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("면세돈제거")
      .setDescription("면세돈을 제거합니다.")
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("금액")
          .setRequired(true)),

    // 세금
    new SlashCommandBuilder()
      .setName("세금률설정")
      .setDescription("주식 세율을 설정합니다.")
      .addIntegerOption(o =>
        o.setName("세율")
          .setDescription("0~100")
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)),

    // 로그
    new SlashCommandBuilder()
      .setName("로그채널")
      .setDescription("경제 로그 채널을 설정합니다.")
      .addChannelOption(o =>
        o.setName("채널")
          .setRequired(true)),

    // 주식
    new SlashCommandBuilder()
      .setName("주식추가")
      .setDescription("주식을 추가합니다.")
      .addStringOption(o =>
        o.setName("이름")
          .setRequired(true))
      .addIntegerOption(o =>
        o.setName("가격")
          .setMinValue(1)
          .setRequired(true))
      .addStringOption(o =>
        o.setName("종류")
          .setDescription("small 또는 large")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("주식삭제")
      .setDescription("주식을 삭제합니다.")
      .addStringOption(o =>
        o.setName("이름")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("주식가격")
      .setDescription("주식 가격을 변경합니다.")
      .addStringOption(o =>
        o.setName("이름")
          .setRequired(true))
      .addIntegerOption(o =>
        o.setName("가격")
          .setMinValue(1)
          .setRequired(true)),

    // 지분
    new SlashCommandBuilder()
      .setName("회장지정")
      .setDescription("회장을 지정합니다.")
      .addStringOption(o =>
        o.setName("회사")
          .setRequired(true))
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("지분추가")
      .setDescription("회사 지분을 추가합니다.")
      .addStringOption(o =>
        o.setName("회사")
          .setRequired(true))
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true))
      .addIntegerOption(o =>
        o.setName("수량")
          .setMinValue(1)
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("지분제거")
      .setDescription("회사 지분을 제거합니다.")
      .addStringOption(o =>
        o.setName("회사")
          .setRequired(true))
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true))
      .addIntegerOption(o =>
        o.setName("수량")
          .setMinValue(1)
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("지분양도")
      .setDescription("지분을 다른 유저에게 양도합니다.")
      .addStringOption(o =>
        o.setName("회사")
          .setRequired(true))
      .addUserOption(o =>
        o.setName("대상")
          .setRequired(true))
      .addIntegerOption(o =>
        o.setName("수량")
          .setMinValue(1)
          .setRequired(true)),

    // 인플레이션
    new SlashCommandBuilder()
      .setName("인플레이션설정")
      .setDescription("인플레이션을 설정합니다.")
      .addIntegerOption(o =>
        o.setName("비율")
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("인플레이션기준설정")
      .setDescription("경제정지 기준을 설정합니다.")
      .addIntegerOption(o =>
        o.setName("비율")
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("경제정지해제")
      .setDescription("경제정지를 해제합니다."),

    new SlashCommandBuilder()
      .setName("경제상태")
      .setDescription("현재 경제 상태를 확인합니다."),

    new SlashCommandBuilder()
      .setName("경제관리자역할")
      .setDescription("경제관리자 역할을 지정합니다.")
      .addRoleOption(o =>
        o.setName("역할")
          .setRequired(true))
  ];
}

// ========================
// 기존 명령어 + 관리자 명령어
// ========================

const originalCommands = commands;

commands = function () {
  return [
    ...originalCommands(),
    ...adminCommands()
  ];
};

// ========================
// 지분 양도
// ========================

async function transferShares(
  guild,
  fromUserId,
  toUserId,
  stockName,
  amount
) {
  const g = getGuild(guild.id);

  const stock = g.stocks[stockName];

  if (!stock) {
    return {
      ok: false,
      message: "존재하지 않는 회사입니다."
    };
  }

  const from = getUser(
    guild.id,
    fromUserId
  );

  const to = getUser(
    guild.id,
    toUserId
  );

  const owned =
    getShares(from, stockName);

  if (owned < amount) {
    return {
      ok: false,
      message:
        `보유 지분이 부족합니다. 현재 ${owned}주`
    };
  }

  setShares(
    from,
    stockName,
    owned - amount
  );

  setShares(
    to,
    stockName,
    getShares(to, stockName) + amount
  );

  stock.holders[fromUserId] =
    getShares(from, stockName);

  stock.holders[toUserId] =
    getShares(to, stockName);

  saveData();

  return {
    ok: true
  };
}

// ========================
// 관리자 / 지분 명령어 처리
// ========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const g = getGuild(guild.id);

  // ========================
  // 일반 잔액
  // ========================

  if (interaction.commandName === "잔액") {
    const user =
      getUser(
        guild.id,
        interaction.user.id
      );

    return interaction.reply({
      content:
        `💵 현금: ${money(user.cash)}\n` +
        `🏦 은행: ${money(user.bank)}\n` +
        `🟢 면세돈: ${money(user.taxFree)}\n` +
        `💳 연체금: ${money(user.overdueLoan)}`,
      ephemeral: true
    });
  }

  // ========================
  // 관리자 확인
  // ========================

  const adminCommandsList = [
    "돈추가",
    "돈제거",
    "면세돈추가",
    "면세돈제거",
    "세금률설정",
    "로그채널",
    "주식추가",
    "주식삭제",
    "주식가격",
    "회장지정",
    "지분추가",
    "지분제거",
    "인플레이션설정",
    "인플레이션기준설정",
    "경제정지해제",
    "경제관리자역할"
  ];

  if (
    adminCommandsList.includes(
      interaction.commandName
    ) &&
    !isAdmin(interaction)
  ) {
    return interaction.reply({
      content:
        "❌ 서버 관리자만 사용할 수 있습니다.",
      ephemeral: true
    });
  }

  // ========================
  // 돈 추가
  // ========================

  if (interaction.commandName === "돈추가") {
    const target =
      interaction.options.getUser("대상");

    const amount =
      toBigInt(
        interaction.options.getString("금액")
      );

    if (amount <= 0n) {
      return interaction.reply({
        content: "❌ 금액이 올바르지 않습니다.",
        ephemeral: true
      });
    }

    const user =
      getUser(guild.id, target.id);

    user.cash =
      addMoney(user.cash, amount);

    saveData();

    await logAction(
      guild,
      `💰 돈 추가 — ${target.tag} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `✅ ${target}에게 ${money(amount)} 추가`,
      ephemeral: true
    });
  }

  // ========================
  // 돈 제거
  // ========================

  if (interaction.commandName === "돈제거") {
    const target =
      interaction.options.getUser("대상");

    const amount =
      toBigInt(
        interaction.options.getString("금액")
      );

    const user =
      getUser(guild.id, target.id);

    user.cash =
      subMoney(user.cash, amount);

    saveData();

    await logAction(
      guild,
      `💰 돈 제거 — ${target.tag} — ${money(amount)}`
    );

    return interaction.reply({
      content:
        `✅ ${target}의 돈 ${money(amount)} 제거`,
      ephemeral: true
    });
  }

  // ========================
  // 면세돈 추가/제거
  // ========================

  if (
    interaction.commandName === "면세돈추가" ||
    interaction.commandName === "면세돈제거"
  ) {
    const target =
      interaction.options.getUser("대상");

    const amount =
      toBigInt(
        interaction.options.getString("금액")
      );

    const user =
      getUser(guild.id, target.id);

    if (
      interaction.commandName ===
      "면세돈추가"
    ) {
      user.taxFree =
        addMoney(
          user.taxFree,
          amount
        );
    } else {
      user.taxFree =
        subMoney(
          user.taxFree,
          amount
        );
    }

    saveData();

    await logAction(
      guild,
      `🟢 면세돈 변경 — ${target.tag} — ${money(amount)}`
    );

    return interaction.reply({
      content: "✅ 처리되었습니다.",
      ephemeral: true
    });
  }

  // ========================
  // 세율
  // ========================

  if (
    interaction.commandName ===
    "세금률설정"
  ) {
    g.taxRate =
      interaction.options.getInteger("세율");

    saveData();

    await logAction(
      guild,
      `🧾 세율 변경 — ${g.taxRate}%`
    );

    return interaction.reply(
      `✅ 주식 세율을 **${g.taxRate}%**로 설정했습니다.`
    );
  }

  // ========================
  // 로그 채널
  // ========================

  if (
    interaction.commandName ===
    "로그채널"
  ) {
    const channel =
      interaction.options.getChannel("채널");

    g.logChannelId = channel.id;

    saveData();

    return interaction.reply(
      `✅ 로그 채널을 ${channel}로 설정했습니다.`
    );
  }

  // ========================
  // 주식 추가
  // ========================

  if (
    interaction.commandName ===
    "주식추가"
  ) {
    const name =
      interaction.options.getString("이름");

    const price =
      interaction.options.getInteger("가격");

    const type =
      interaction.options.getString("종류")
        .toLowerCase();

    if (!["small", "large"].includes(type)) {
      return interaction.reply({
        content:
          "❌ 종류는 `small` 또는 `large`입니다.",
        ephemeral: true
      });
    }

    if (g.stocks[name]) {
      return interaction.reply({
        content: "❌ 이미 존재하는 주식입니다.",
        ephemeral: true
      });
    }

    const smallCount =
      Object.values(g.stocks)
        .filter(s => s.type === "small")
        .length;

    if (
      type === "small" &&
      smallCount >= 20
    ) {
      return interaction.reply({
        content:
          "❌ 소형 주식은 최대 20종류입니다.",
        ephemeral: true
      });
    }

    g.stocks[name] =
      createStock(
        name,
        price,
        type
      );

    saveData();

    await logAction(
      guild,
      `📈 주식 추가 — ${name} — ${price}원`
    );

    return interaction.reply(
      `✅ **${name}** 주식을 추가했습니다.`
    );
  }

  // ========================
  // 주식 삭제
  // ========================

  if (
    interaction.commandName ===
    "주식삭제"
  ) {
    const name =
      interaction.options.getString("이름");

    const stock = g.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "❌ 존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    if (totalShares(stock) > 0) {
      return interaction.reply({
        content:
          "❌ 누군가 보유하고 있어 삭제할 수 없습니다.",
        ephemeral: true
      });
    }

    delete g.stocks[name];

    saveData();

    await logAction(
      guild,
      `🗑️ 주식 삭제 — ${name}`
    );

    return interaction.reply(
      `✅ **${name}** 삭제 완료`
    );
  }

  // ========================
  // 주식 가격
  // ========================

  if (
    interaction.commandName ===
    "주식가격"
  ) {
    const name =
      interaction.options.getString("이름");

    const price =
      interaction.options.getInteger("가격");

    const stock = g.stocks[name];

    if (!stock) {
      return interaction.reply({
        content: "❌ 존재하지 않는 주식입니다.",
        ephemeral: true
      });
    }

    const oldPrice =
      stock.price;

    stock.price =
      price;

    saveData();

    await logAction(
      guild,
      `📊 주가 변경 — ${name} — ${oldPrice}원 → ${price}원`
    );

    return interaction.reply(
      `✅ **${name}** 가격을 ${price.toLocaleString()}원으로 변경했습니다.`
    );
  }

  // ========================
  // 회장 지정
  // ========================

  if (
    interaction.commandName ===
    "회장지정"
  ) {
    const company =
      interaction.options.getString("회사");

    const target =
      interaction.options.getUser("대상");

    const stock =
      g.stocks[company];

    if (!stock) {
      return interaction.reply({
        content: "❌ 존재하지 않는 회사입니다.",
        ephemeral: true
      });
    }

    stock.chairmanUserId =
      target.id;

    saveData();

    await logAction(
      guild,
      `👑 회장 지정 — ${company} — ${target.tag}`
    );

    return interaction.reply(
      `👑 **${company}**의 회장을 ${target}으로 지정했습니다.`
    );
  }

  // ========================
  // 지분 추가
  // ========================

  if (
    interaction.commandName ===
    "지분추가"
  ) {
    const company =
      interaction.options.getString("회사");

    const target =
      interaction.options.getUser("대상");

    const amount =
      interaction.options.getInteger("수량");

    const stock =
      g.stocks[company];

    if (!stock) {
      return interaction.reply({
        content: "❌ 존재하지 않는 회사입니다.",
        ephemeral: true
      });
    }

    const user =
      getUser(guild.id, target.id);

    setShares(
      user,
      company,
      getShares(user, company) +
      amount
    );

    stock.holders[target.id] =
      getShares(user, company);

    saveData();

    await logAction(
      guild,
      `🏢 지분 추가 — ${company} — ${target.tag} — ${amount}주`
    );

    return interaction.reply(
      `✅ ${target}에게 ${amount}주 추가했습니다.`
    );
  }

  // ========================
  // 지분 제거
  // ========================

  if (
    interaction.commandName ===
    "지분제거"
  ) {
    const company =
      interaction.options.getString("회사");

    const target =
      interaction.options.getUser("대상");

    const amount =
      interaction.options.getInteger("수량");

    const stock =
      g.stocks[company];

    if (!stock) {
      return interaction.reply({
        content: "❌ 존재하지 않는 회사입니다.",
        ephemeral: true
      });
    }

    const user =
      getUser(guild.id, target.id);

    const owned =
      getShares(user, company);

    if (owned < amount) {
      return interaction.reply({
        content: "❌ 보유 지분보다 많습니다.",
        ephemeral: true
      });
    }

    setShares(
      user,
      company,
      owned - amount
    );

    stock.holders[target.id] =
      getShares(user, company);

    saveData();

    await logAction(
      guild,
      `🏢 지분 제거 — ${company} — ${target.tag} — ${amount}주`
    );

    return interaction.reply(
      `✅ ${target}의 지분 ${amount}주를 제거했습니다.`
    );
  }

  // ========================
  // 지분 양도
  // ========================

  if (
    interaction.commandName ===
    "지분양도"
  ) {
    const company =
      interaction.options.getString("회사");

    const target =
      interaction.options.getUser("대상");

    const amount =
      interaction.options.getInteger("수량");

    if (target.bot) {
      return interaction.reply({
        content: "❌ 봇에게 양도할 수 없습니다.",
        ephemeral: true
      });
    }

    const result =
      await transferShares(
        guild,
        interaction.user.id,
        target.id,
        company,
        amount
      );

    if (!result.ok) {
      return interaction.reply({
        content: `❌ ${result.message}`,
        ephemeral: true
      });
    }

    await logAction(
      guild,
      `🔄 지분 양도 — ${interaction.user.tag} → ${target.tag} — ${company} ${amount}주`
    );

    return interaction.reply(
      `✅ ${company} 지분 ${amount}주를 ${target}에게 양도했습니다.`
    );
  }

  // ========================
  // 인플레이션
  // ========================

  if (
    interaction.commandName ===
    "인플레이션설정"
  ) {
    const value =
      interaction.options.getInteger("비율");

    const wasPaused =
      g.economyPaused;

    g.inflation = value;

    if (
      value >= g.inflationLimit &&
      !wasPaused
    ) {
      g.economyPaused = true;

      g.inflationEmergencySnapshot = {
        at: Date.now(),
        inflation: value
      };

      // 보유 주식 1주 강제 회수
      for (const [userId, user] of Object.entries(g.users)) {
        for (const stockName of Object.keys(user.stocks)) {
          const qty =
            getShares(user, stockName);

          if (qty > 0) {
            setShares(
              user,
              stockName,
              qty - 1
            );

            const stock =
              g.stocks[stockName];

            if (stock) {
              stock.holders[userId] =
                getShares(user, stockName);
            }
          }
        }
      }

      saveData();

      await logAction(
        guild,
        `🚨 인플레이션 ${value}% 도달 — 경제 자동정지 및 보유 주식 1주씩 회수`
      );

    } else {
      saveData();
    }

    return interaction.reply(
      `📉 인플레이션: **${value}%**\n` +
      `경제 상태: **${g.economyPaused ? "정지" : "정상"}**`
    );
  }

  // ========================
  // 인플레이션 기준
  // ========================

  if (
    interaction.commandName ===
    "인플레이션기준설정"
  ) {
    const value =
      interaction.options.getInteger("비율");

    g.inflationLimit =
      value;

    saveData();

    return interaction.reply(
      `✅ 경제정지 기준을 **${value}%**로 설정했습니다.`
    );
  }

  // ========================
  // 경제 정지 해제
  // ========================

  if (
    interaction.commandName ===
    "경제정지해제"
  ) {
    g.economyPaused = false;

    saveData();

    await logAction(
      guild,
      `🟢 경제정지 해제 — ${interaction.user.tag}`
    );

    return interaction.reply(
      "🟢 경제정지를 해제했습니다."
    );
  }

  // ========================
  // 경제 상태
  // ========================

  if (
    interaction.commandName ===
    "경제상태"
  ) {
    return interaction.reply(
      `📊 **경제 상태**\n\n` +
      `인플레이션: ${g.inflation}%\n` +
      `정지 기준: ${g.inflationLimit}%\n` +
      `경제: ${g.economyPaused ? "⛔ 정지" : "🟢 정상"}\n` +
      `주식 세율: ${g.taxRate}%`
    );
  }

  // ========================
  // 경제 관리자 역할
  // ========================

  if (
    interaction.commandName ===
    "경제관리자역할"
  ) {
    const role =
      interaction.options.getRole("역할");

    g.economyAdminRoleId =
      role.id;

    saveData();

    return interaction.reply(
      `✅ 경제관리자 역할을 ${role}로 설정했습니다.`
    );
  }

  // ========================
  // 주식 메뉴
  // ========================

  if (
    interaction.commandName ===
    "주식메뉴"
  ) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 서버 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    await sendStockMenu(
      interaction.channel,
      guild.id
    );

    return interaction.reply({
      content: "✅ 주식 메뉴를 생성했습니다.",
      ephemeral: true
    });
  }

  // ========================
  // 은행 메뉴
  // ========================

  if (
    interaction.commandName ===
    "은행"
  ) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ 서버 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    await sendBankMenu(
      interaction.channel
    );

    return interaction.reply({
      content: "✅ 은행 메뉴를 생성했습니다.",
      ephemeral: true
    });
  }
});

// ========================
// 자동 주가 변동
// ========================

setInterval(() => {

  for (const guild of client.guilds.cache.values()) {
    const g = getGuild(guild.id);

    for (const stock of Object.values(g.stocks)) {

      const oldPrice =
        stockPrice(stock);

      const movement =
        0.95 +
        Math.random() * 0.10;

      stock.price =
        Math.max(
          1,
          Math.floor(
            oldPrice * movement
          )
        );
    }
  }

  saveData();

}, 5 * 60 * 1000);

// ========================
// 최종 로그인
// ========================

client.login(TOKEN);
