// ================================================
// Discord 통합 경제 봇
// 1/4: 기본 설정 및 데이터 저장
// ================================================

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  throw new Error(
    "DISCORD_TOKEN 또는 CLIENT_ID가 없습니다."
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const rest = new REST({
  version: "10"
}).setToken(TOKEN);

const DATA_FILE = path.join(
  __dirname,
  "bot-data.json"
);

let data = { guilds: {} };

// ------------------------------
// 데이터 불러오기
// ------------------------------

if (fs.existsSync(DATA_FILE)) {
  try {
    const loaded = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    if (loaded && loaded.guilds) {
      data = loaded;
    }
  } catch (error) {
    console.error(
      "데이터 읽기 오류:",
      error.message
    );
  }
}

// ------------------------------
// 데이터 저장
// ------------------------------

function saveData() {
  try {
    const temp = DATA_FILE + ".tmp";

    fs.writeFileSync(
      temp,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    fs.renameSync(temp, DATA_FILE);
  } catch (error) {
    console.error(
      "데이터 저장 오류:",
      error.message
    );
  }
}

// ------------------------------
// 서버 데이터
// ------------------------------

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      users: {},
      companies: {},
      stocks: {},
      elections: {
        active: false,
        candidates: {},
        voters: {}
      },
      exchangeRequests: {},
      savings: {},
      loans: {},

      taxRate: 20,
      inflation: 0,
      inflationLimit: 20,
      economyPaused: false,

      logChannelId: null,
      economyAdminRoleId: null,

      nextExchangeId: 1,
      nextSavingsId: 1,
      nextLoanId: 1
    };

    saveData();
  }

  const g = data.guilds[guildId];

  g.users ??= {};
  g.companies ??= {};
  g.stocks ??= {};
  g.exchangeRequests ??= {};
  g.savings ??= {};
  g.loans ??= {};

  g.elections ??= {
    active: false,
    candidates: {},
    voters: {}
  };

  g.elections.candidates ??= {};
  g.elections.voters ??= {};

  g.taxRate ??= 20;
  g.inflation ??= 0;
  g.inflationLimit ??= 20;
  g.economyPaused ??= false;

  g.logChannelId ??= null;
  g.economyAdminRoleId ??= null;

  g.nextExchangeId ??= 1;
  g.nextSavingsId ??= 1;
  g.nextLoanId ??= 1;

  return g;
}

// ------------------------------
// 사용자 데이터
// ------------------------------

function getUser(guildId, userId) {
  const g = getGuild(guildId);

  if (!g.users[userId]) {
    g.users[userId] = {
      cash: "0",
      bank: "0",
      taxFree: "0",
      stocks: {},
      shares: {},
      savings: [],
      loans: [],
      overdueLoan: "0"
    };

    saveData();
  }

  const u = g.users[userId];

  u.cash ??= "0";
  u.bank ??= "0";
  u.taxFree ??= "0";

  u.stocks ??= {};
  u.shares ??= {};
  u.savings ??= [];
  u.loans ??= [];

  u.overdueLoan ??= "0";

  return u;
}

// ------------------------------
// 금액 처리
// ------------------------------

function toBigInt(value) {
  const s = String(value ?? "")
    .replace(/,/g, "")
    .replace(/원/g, "")
    .trim();

  if (!/^\d+$/.test(s)) {
    return 0n;
  }

  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function money(value) {
  return (
    toBigInt(value).toLocaleString("ko-KR") +
    "원"
  );
}

function addMoney(current, amount) {
  return (
    toBigInt(current) +
    toBigInt(amount)
  ).toString();
}

function subMoney(current, amount) {
  const result =
    toBigInt(current) - toBigInt(amount);

  return (result < 0n ? 0n : result).toString();
}

// ------------------------------
// 권한 확인
// ------------------------------

function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function isEconomyOfficer(interaction) {
  if (isAdmin(interaction)) {
    return true;
  }

  const g = getGuild(interaction.guildId);
  const roleId = g.economyAdminRoleId;

  if (!roleId) {
    return false;
  }

  return Boolean(
    interaction.member?.roles?.cache?.has(roleId)
  );
}

function isChairman(
  guildId,
  companyName,
  userId
) {
  const g = getGuild(guildId);

  return (
    g.companies[companyName]?.chairmanId === userId
  );
}

// ------------------------------
// 로그
// ------------------------------

async function logAction(guild, message) {
  const g = getGuild(guild.id);

  if (!g.logChannelId) {
    return;
  }

  try {
    const channel =
      await guild.channels.fetch(g.logChannelId);

    if (channel?.isTextBased()) {
      await channel.send({
        content: message
      });
    }
  } catch (error) {
    console.error(
      "로그 전송 실패:",
      error.message
    );
  }
}

// ------------------------------
// 기업 지분 계산
// ------------------------------

function getShares(user, companyName) {
  return Math.max(
    0,
    Number(user.shares[companyName] || 0)
  );
}

function setShares(user, companyName, amount) {
  const quantity = Math.max(
    0,
    Math.floor(Number(amount) || 0)
  );

  if (quantity === 0) {
    delete user.shares[companyName];
  } else {
    user.shares[companyName] = quantity;
  }
}

function totalCompanyShares(
  guildId,
  companyName
) {
  const g = getGuild(guildId);

  return Object.values(g.users).reduce(
    (total, user) =>
      total + getShares(user, companyName),
    0
  );
}

function sharePercent(
  guildId,
  userId,
  companyName
) {
  const total = totalCompanyShares(
    guildId,
    companyName
  );

  if (total === 0) {
    return 0;
  }

  const user = getUser(guildId, userId);

  return (
    getShares(user, companyName) /
    total *
    100
  );
}

// ------------------------------
// 주식 초기화
// ------------------------------

function createStock(name, price) {
  return {
    name,
    price: Math.max(1, Number(price)),
    holders: {},
    updatedAt: Date.now()
  };
}

// ------------------------------
// 자산 계산
// ------------------------------

function calculateAssets(guildId, userId) {
  const g = getGuild(guildId);
  const user = getUser(guildId, userId);

  let stockValue = 0n;
  let shareValue = 0n;

  for (const [name, quantity] of Object.entries(user.stocks)) {
    const stock = g.stocks[name];

    if (stock) {
      stockValue +=
        BigInt(Math.max(0, Number(quantity))) *
        BigInt(Math.max(0, Number(stock.price)));
    }
  }

  for (const [name, quantity] of Object.entries(user.shares)) {
    const company = g.companies[name];

    if (company) {
      shareValue +=
        BigInt(Math.max(0, Number(quantity))) *
        BigInt(Math.max(0, Number(company.sharePrice || 0)));
    }
  }

  return (
    toBigInt(user.cash) +
    toBigInt(user.bank) +
    toBigInt(user.taxFree) +
    stockValue +
    shareValue
  );
}

// ------------------------------
// 봇 준비
// ------------------------------

client.once("ready", () => {
  console.log(
    `봇 로그인 성공: ${client.user.tag}`
  );

  saveData();
});

// 1/4 끝
// 2/4 코드를 이 아래에 이어 붙이기
// 로그인 코드는 4/4 마지막에만 추가
// ================================================
// 2/4: 선거 · 은행 · 적금 · 대출
// ================================================

const commands2 = [
  new SlashCommandBuilder()
    .setName("선거시작")
    .setDescription("새 선거를 시작합니다."),

  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("선거 후보를 등록합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("후보 이름").setRequired(true)),

  new SlashCommandBuilder()
    .setName("투표")
    .setDescription("후보에게 투표합니다.")
    .addStringOption(o =>
      o.setName("후보").setDescription("후보 이름").setRequired(true)),

  new SlashCommandBuilder()
    .setName("선거종료")
    .setDescription("선거를 종료합니다."),

  new SlashCommandBuilder()
    .setName("후보목록")
    .setDescription("후보 목록을 확인합니다."),

  new SlashCommandBuilder()
    .setName("결과")
    .setDescription("선거 결과를 확인합니다."),

  new SlashCommandBuilder()
    .setName("잔액")
    .setDescription("내 잔액을 확인합니다."),

  new SlashCommandBuilder()
    .setName("은행입금")
    .setDescription("은행에 입금합니다.")
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)),

  new SlashCommandBuilder()
    .setName("은행출금")
    .setDescription("은행에서 출금합니다.")
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)),

  new SlashCommandBuilder()
    .setName("송금")
    .setDescription("다른 유저에게 송금합니다.")
    .addUserOption(o =>
      o.setName("대상").setDescription("받는 사람").setRequired(true))
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)),

  new SlashCommandBuilder()
    .setName("적금가입")
    .setDescription("적금에 가입합니다.")
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true))
    .addIntegerOption(o =>
      o.setName("기간").setDescription("개월")
        .addChoices(
          { name: "1개월", value: 1 },
          { name: "3개월", value: 3 }
        ).setRequired(true)),

  new SlashCommandBuilder()
    .setName("적금목록")
    .setDescription("내 적금 목록을 확인합니다."),

  new SlashCommandBuilder()
    .setName("대출")
    .setDescription("대출을 신청합니다.")
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)),

  new SlashCommandBuilder()
    .setName("대출상환")
    .setDescription("대출금을 상환합니다.")
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)),

  new SlashCommandBuilder()
    .setName("대출현황")
    .setDescription("내 대출 현황을 확인합니다.")
];

// 명령어 등록 함수
// 최종 4/4에서 전체 명령어를 한 번에 등록할 예정

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const gid = guild.id;
  const uid = interaction.user.id;
  const g = getGuild(gid);
  const u = getUser(gid, uid);
  const cmd = interaction.commandName;

  // -------------------------
  // 선거 시작
  // -------------------------
  if (cmd === "선거시작") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 선거를 시작할 수 있습니다.",
        ephemeral: true
      });
    }

    if (g.elections.active) {
      return interaction.reply({
        content: "이미 선거가 진행 중입니다.",
        ephemeral: true
      });
    }

    g.elections = {
      active: true,
      candidates: {},
      voters: {},
      startedAt: Date.now()
    };

    saveData();
    await logAction(guild, "🗳️ 선거가 시작되었습니다.");

    return interaction.reply("🗳️ 선거가 시작되었습니다!");
  }

  // 후보 등록
  if (cmd === "후보등록") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 후보를 등록할 수 있습니다.",
        ephemeral: true
      });
    }

    if (!g.elections.active) {
      return interaction.reply({
        content: "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const name =
      interaction.options.getString("이름").trim();

    if (
      !name ||
      name.length > 50 ||
      g.elections.candidates[name]
    ) {
      return interaction.reply({
        content: "후보 이름이 잘못되었거나 이미 등록되었습니다.",
        ephemeral: true
      });
    }

    if (Object.keys(g.elections.candidates).length >= 20) {
      return interaction.reply({
        content: "후보는 최대 20명까지 등록할 수 있습니다.",
        ephemeral: true
      });
    }

    g.elections.candidates[name] = 0;
    saveData();

    return interaction.reply(`✅ 후보 **${name}** 등록 완료!`);
  }

  // 투표
  if (cmd === "투표") {
    if (!g.elections.active) {
      return interaction.reply({
        content: "현재 진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    const candidate =
      interaction.options.getString("후보").trim();

    if (!(candidate in g.elections.candidates)) {
      return interaction.reply({
        content: "후보를 찾을 수 없습니다.",
        ephemeral: true
      });
    }

    if (g.elections.voters[uid]) {
      return interaction.reply({
        content: "이미 투표했습니다.",
        ephemeral: true
      });
    }

    g.elections.candidates[candidate]++;
    g.elections.voters[uid] = candidate;

    saveData();

    await logAction(
      guild,
      `🗳️ ${interaction.user.tag} 투표 완료`
    );

    return interaction.reply({
      content: `✅ **${candidate}** 후보에게 투표했습니다.`,
      ephemeral: true
    });
  }

  // 후보 목록
  if (cmd === "후보목록") {
    const entries =
      Object.entries(g.elections.candidates);

    if (!entries.length) {
      return interaction.reply({
        content: "등록된 후보가 없습니다.",
        ephemeral: true
      });
    }

    const text = entries
      .map(([name, votes]) => `• ${name}: ${votes}표`)
      .join("\n");

    return interaction.reply(`🗳️ **후보 목록**\n${text}`);
  }

  // 선거 결과
  if (cmd === "결과") {
    const entries =
      Object.entries(g.elections.candidates)
        .sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      return interaction.reply({
        content: "결과가 없습니다.",
        ephemeral: true
      });
    }

    return interaction.reply(
      "🏆 **선거 결과**\n" +
      entries.map(([name, votes], i) =>
        `${i + 1}위 ${name}: ${votes}표`
      ).join("\n")
    );
  }

  // 선거 종료
  if (cmd === "선거종료") {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "관리자만 종료할 수 있습니다.",
        ephemeral: true
      });
    }

    if (!g.elections.active) {
      return interaction.reply({
        content: "진행 중인 선거가 없습니다.",
        ephemeral: true
      });
    }

    g.elections.active = false;
    saveData();

    await logAction(guild, "🏁 선거가 종료되었습니다.");

    const entries =
      Object.entries(g.elections.candidates)
        .sort((a, b) => b[1] - a[1]);

    return interaction.reply(
      "🏁 **선거 종료 결과**\n" +
      (entries.length
        ? entries.map(([name, votes], i) =>
            `${i + 1}위 ${name}: ${votes}표`
          ).join("\n")
        : "후보가 없습니다.")
    );
  }

  // 잔액
  if (cmd === "잔액") {
    return interaction.reply({
      content:
        `💵 현금: ${money(u.cash)}\n` +
        `🏦 은행: ${money(u.bank)}\n` +
        `🟢 면세돈: ${money(u.taxFree)}`,
      ephemeral: true
    });
  }

  // 은행 입금
  if (cmd === "은행입금") {
    if (g.economyPaused) {
      return interaction.reply({
        content: "경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    const amount =
      toBigInt(interaction.options.getString("금액"));

    if (amount <= 0n || toBigInt(u.cash) < amount) {
      return interaction.reply({
        content: "금액이 잘못되었거나 현금이 부족합니다.",
        ephemeral: true
      });
    }

    u.cash = subMoney(u.cash, amount);
    u.bank = addMoney(u.bank, amount);

    saveData();

    return interaction.reply({
      content: `✅ ${money(amount)} 입금 완료`,
      ephemeral: true
    });
  }

  // 은행 출금
  if (cmd === "은행출금") {
    if (g.economyPaused) {
      return interaction.reply({
        content: "경제가 정지되어 있습니다.",
        ephemeral: true
      });
    }

    const amount =
      toBigInt(interaction.options.getString("금액"));

    if (amount <= 0n || toBigInt(u.bank) < amount) {
      return interaction.reply({
        content: "금액이 잘못되었거나 은행 잔액이 부족합니다.",
        ephemeral: true
      });
    }

    u.bank = subMoney(u.bank, amount);
    u.cash = addMoney(u.cash, amount);

    saveData();

    return interaction.reply({
      content: `✅ ${money(amount)} 출금 완료`,
      ephemeral: true
    });
  }

  // 송금
  if (cmd === "송금") {
    const target =
      interaction.options.getUser("대상");

    const amount =
      toBigInt(interaction.options.getString("금액"));

    if (
      g.economyPaused ||
      target.bot ||
      target.id === uid ||
      amount <= 0n ||
      toBigInt(u.cash) < amount
    ) {
      return interaction.reply({
        content: "송금 조건을 확인하세요.",
        ephemeral: true
      });
    }

    const receiver = getUser(gid, target.id);

    u.cash = subMoney(u.cash, amount);
    receiver.cash = addMoney(receiver.cash, amount);

    saveData();

    return interaction.reply(
      `✅ ${target}에게 ${money(amount)} 송금했습니다.`
    );
  }

  // 적금 가입
  if (cmd === "적금가입") {
    const amount =
      toBigInt(interaction.options.getString("금액"));

    const months =
      interaction.options.getInteger("기간");

    if (
      g.economyPaused ||
      amount <= 0n ||
      toBigInt(u.cash) < amount
    ) {
      return interaction.reply({
        content: "경제 상태 또는 금액을 확인하세요.",
        ephemeral: true
      });
    }

    const saving = {
      id: g.nextSavingsId++,
      principal: amount.toString(),
      months,
      rate: months === 1 ? 2.1 : 3,
      maturityAt:
        Date.now() +
        months * 30 * 24 * 60 * 60 * 1000,
      status: "active"
    };

    u.cash = subMoney(u.cash, amount);
    u.savings.push(saving);

    saveData();

    return interaction.reply({
      content:
        `✅ ${months}개월 적금 가입 완료\n` +
        `원금: ${money(amount)}\n` +
        `이율: ${saving.rate}%`,
      ephemeral: true
    });
  }

  // 적금 목록
  if (cmd === "적금목록") {
    const active =
      u.savings.filter(s => s.status === "active");

    if (!active.length) {
      return interaction.reply({
        content: "가입한 적금이 없습니다.",
        ephemeral: true
      });
    }

    return interaction.reply({
      content: active.map(s =>
        `적금 #${s.id} — ${money(s.principal)} — ${s.rate}% — <t:${Math.floor(s.maturityAt / 1000)}:R>`
      ).join("\n"),
      ephemeral: true
    });
  }

  // 대출
  if (cmd === "대출") {
    const amount =
      toBigInt(interaction.options.getString("금액"));

    if (g.economyPaused || amount <= 0n) {
      return interaction.reply({
        content: "경제 상태 또는 금액을 확인하세요.",
        ephemeral: true
      });
    }

    const loan = {
      id: g.nextLoanId++,
      principal: amount.toString(),
      remaining: amount.toString(),
      dueAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active"
    };

    u.loans.push(loan);
    u.cash = addMoney(u.cash, amount);

    saveData();

    return interaction.reply({
      content:
        `✅ 대출 ${money(amount)} 완료\n` +
        `상환 기한: <t:${Math.floor(loan.dueAt / 1000)}:R>`,
      ephemeral: true
    });
  }

  // 대출 현황
  if (cmd === "대출현황") {
    const active =
      u.loans.filter(l => l.status === "active");

    return interaction.reply({
      content: active.length
        ? active.map(l =>
            `대출 #${l.id}: ${money(l.remaining)} — <t:${Math.floor(l.dueAt / 1000)}:R>`
          ).join("\n")
        : "갚을 대출이 없습니다.",
      ephemeral: true
    });
  }

  // 대출 상환
  if (cmd === "대출상환") {
    const amount =
      toBigInt(interaction.options.getString("금액"));

    if (amount <= 0n || toBigInt(u.cash) < amount) {
      return interaction.reply({
        content: "현금이 부족하거나 금액이 잘못되었습니다.",
        ephemeral: true
      });
    }

    let left = amount;

    for (const loan of u.loans) {
      if (loan.status !== "active" || left <= 0n) continue;

      const debt = toBigInt(loan.remaining);
      const paid = debt < left ? debt : left;

      loan.remaining = (debt - paid).toString();
      left -= paid;

      if (toBigInt(loan.remaining) === 0n) {
        loan.status = "paid";
      }
    }

    const paid = amount - left;

    u.cash = subMoney(u.cash, paid);

    saveData();

    return interaction.reply({
      content: `✅ 대출 ${money(paid)} 상환 완료`,
      ephemeral: true
    });
  }
});
// ================================================
// 3/4: 기업 · 지분 · 주식 · 환전 · 경제 설정
// ================================================

const commands3 = [
  new SlashCommandBuilder()
    .setName("경제관리자역할")
    .setDescription("경제관리자 역할을 지정합니다.")
    .addRoleOption(o =>
      o.setName("역할").setDescription("경제관리자 역할").setRequired(true)),

  new SlashCommandBuilder()
    .setName("로그채널")
    .setDescription("경제 로그 채널을 지정합니다.")
    .addChannelOption(o =>
      o.setName("채널").setDescription("로그 채널").setRequired(true)),

  new SlashCommandBuilder()
    .setName("기업생성")
    .setDescription("기업을 생성합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("기업 이름").setRequired(true))
    .addUserOption(o =>
      o.setName("회장").setDescription("기업 회장").setRequired(true))
    .addIntegerOption(o =>
      o.setName("주식가격").setDescription("지분 1개의 가격").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("기업삭제")
    .setDescription("기업을 삭제합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("기업 이름").setRequired(true)),

  new SlashCommandBuilder()
    .setName("기업목록")
    .setDescription("기업 목록을 확인합니다."),

  new SlashCommandBuilder()
    .setName("회장지정")
    .setDescription("기업 회장을 지정합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true))
    .addUserOption(o =>
      o.setName("유저").setDescription("새 회장").setRequired(true)),

  new SlashCommandBuilder()
    .setName("지분발행")
    .setDescription("기업 지분을 발행합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true))
    .addIntegerOption(o =>
      o.setName("수량").setDescription("발행 수량").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("지분지급")
    .setDescription("유저에게 기업 지분을 지급합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true))
    .addUserOption(o =>
      o.setName("유저").setDescription("받을 유저").setRequired(true))
    .addIntegerOption(o =>
      o.setName("수량").setDescription("지분 수량").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("지분양도")
    .setDescription("보유 지분을 다른 유저에게 양도합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true))
    .addUserOption(o =>
      o.setName("유저").setDescription("받을 유저").setRequired(true))
    .addIntegerOption(o =>
      o.setName("수량").setDescription("양도 수량").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("지분회수")
    .setDescription("기업 지분을 회수합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true))
    .addUserOption(o =>
      o.setName("유저").setDescription("회수 대상").setRequired(true))
    .addIntegerOption(o =>
      o.setName("수량").setDescription("회수 수량").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("지분현황")
    .setDescription("기업 지분 분배 현황을 확인합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true)),

  new SlashCommandBuilder()
    .setName("배당금")
    .setDescription("기업 배당금을 지급합니다.")
    .addStringOption(o =>
      o.setName("기업").setDescription("기업 이름").setRequired(true))
    .addStringOption(o =>
      o.setName("총액").setDescription("배당 총액").setRequired(true)),

  new SlashCommandBuilder()
    .setName("주식추가")
    .setDescription("주식 종목을 추가합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("종목 이름").setRequired(true))
    .addIntegerOption(o =>
      o.setName("가격").setDescription("주당 가격").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("주식삭제")
    .setDescription("주식 종목을 삭제합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("종목 이름").setRequired(true)),

  new SlashCommandBuilder()
    .setName("주식목록")
    .setDescription("주식 종목과 가격을 확인합니다."),

  new SlashCommandBuilder()
    .setName("주식구매")
    .setDescription("주식을 구매합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목 이름").setRequired(true))
    .addIntegerOption(o =>
      o.setName("수량").setDescription("구매 수량").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("주식판매")
    .setDescription("보유 주식을 판매합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목 이름").setRequired(true))
    .addIntegerOption(o =>
      o.setName("수량").setDescription("판매 수량").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("주가변경")
    .setDescription("주식 가격을 변경합니다.")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목 이름").setRequired(true))
    .addIntegerOption(o =>
      o.setName("가격").setDescription("새 가격").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("세율설정")
    .setDescription("주식 판매 세율을 설정합니다.")
    .addIntegerOption(o =>
      o.setName("퍼센트").setDescription("세율 0~100").setMinValue(0).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName("환전신청")
    .setDescription("환전을 신청합니다.")
    .addStringOption(o =>
      o.setName("금액").setDescription("환전할 현금").setRequired(true)),

  new SlashCommandBuilder()
    .setName("환전승인")
    .setDescription("환전 신청을 승인합니다.")
    .addIntegerOption(o =>
      o.setName("번호").setDescription("신청 번호").setMinValue(1).setRequired(true))
    .addIntegerOption(o =>
      o.setName("환율").setDescription("1원당 환전 단위").setMinValue(1).setRequired(true)),

  new SlashCommandBuilder()
    .setName("환전목록")
    .setDescription("환전 신청 목록을 확인합니다."),

  new SlashCommandBuilder()
    .setName("인플레이션설정")
    .setDescription("인플레이션 수치를 설정합니다.")
    .addIntegerOption(o =>
      o.setName("수치").setDescription("0~100").setMinValue(0).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName("경제현황")
    .setDescription("현재 경제 설정을 확인합니다."),

  new SlashCommandBuilder()
    .setName("자산순위")
    .setDescription("서버 자산 순위를 확인합니다.")
];

// 환전 신청 번호는 서버별로 관리
function ensureExchangeNumber(g) {
  g.nextExchangeId ??= 1;
}

// 기업 생성
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const gid = interaction.guildId;
  const uid = interaction.user.id;
  const g = getGuild(gid);
  const u = getUser(gid, uid);
  const cmd = interaction.commandName;
  const admin = isAdmin(interaction);
  const officer = isEconomyOfficer(interaction);

  const companyName =
    interaction.options.getString("기업");

  const replyPrivate = async content =>
    interaction.reply({ content, ephemeral: true });

  // 경제 관리자 역할 지정
  if (cmd === "경제관리자역할") {
    if (!admin) return replyPrivate("관리자만 설정할 수 있습니다.");

    const role = interaction.options.getRole("역할");
    g.economyAdminRoleId = role.id;
    saveData();

    return interaction.reply(`✅ 경제관리자 역할: ${role}`);
  }

  // 로그 채널 지정
  if (cmd === "로그채널") {
    if (!admin) return replyPrivate("관리자만 설정할 수 있습니다.");

    const channel = interaction.options.getChannel("채널");
    if (!channel.isTextBased()) {
      return replyPrivate("텍스트 채널을 선택하세요.");
    }

    g.logChannelId = channel.id;
    saveData();

    return interaction.reply(`✅ 경제 로그 채널: ${channel}`);
  }

  // 기업 생성
  if (cmd === "기업생성") {
    if (!admin && !officer) {
      return replyPrivate("관리자 또는 경제관리자만 가능합니다.");
    }

    const name = interaction.options.getString("이름").trim();
    const chairman = interaction.options.getUser("회장");
    const price = interaction.options.getInteger("주식가격");

    if (!name || name.length > 50 || g.companies[name]) {
      return replyPrivate("기업 이름이 잘못되었거나 이미 존재합니다.");
    }

    g.companies[name] = {
      name,
      chairmanId: chairman.id,
      sharePrice: price,
      issuedShares: 0,
      dividendRate: 0
    };

    saveData();
    await logAction(interaction.guild, `🏢 기업 생성: ${name}`);

    return interaction.reply(
      `🏢 **${name}** 기업 생성 완료!\n회장: ${chairman}\n지분 가격: ${money(price)}`
    );
  }

  // 기업 삭제
  if (cmd === "기업삭제") {
    if (!admin && !officer) {
      return replyPrivate("관리자 또는 경제관리자만 가능합니다.");
    }

    const name = interaction.options.getString("이름");
    if (!g.companies[name]) return replyPrivate("기업을 찾을 수 없습니다.");

    delete g.companies[name];
    for (const user of Object.values(g.users)) {
      delete user.shares[name];
    }

    saveData();
    await logAction(interaction.guild, `🗑️ 기업 삭제: ${name}`);

    return interaction.reply(`✅ **${name}** 기업을 삭제했습니다.`);
  }

  // 기업 목록
  if (cmd === "기업목록") {
    const names = Object.keys(g.companies);

    return interaction.reply(
      names.length
        ? "🏢 **기업 목록**\n" + names.map(n => `• ${n}`).join("\n")
        : "등록된 기업이 없습니다."
    );
  }

  // 회장 지정
  if (cmd === "회장지정") {
    if (!admin && !officer) {
      return replyPrivate("관리자 또는 경제관리자만 가능합니다.");
    }

    const name = interaction.options.getString("기업");
    const chairman = interaction.options.getUser("유저");

    if (!g.companies[name]) return replyPrivate("기업을 찾을 수 없습니다.");

    g.companies[name].chairmanId = chairman.id;
    saveData();

    return interaction.reply(`👑 **${name}** 새 회장: ${chairman}`);
  }

  // 지분 발행
  if (cmd === "지분발행") {
    const name = interaction.options.getString("기업");
    const amount = interaction.options.getInteger("수량");
    const company = g.companies[name];

    if (!company) return replyPrivate("기업을 찾을 수 없습니다.");
    if (!officer && company.chairmanId !== uid) {
      return replyPrivate("해당 기업 회장 또는 경제관리자만 가능합니다.");
    }

    company.issuedShares += amount;
    const current = getShares(u, name);
    setShares(u, name, current + amount);

    saveData();

    return interaction.reply(
      `📊 **${name}** 지분 ${amount}개 발행 완료.\n발행 지분은 명령 실행자에게 지급되었습니다.`
    );
  }

  // 지분 지급
  if (cmd === "지분지급") {
    const name = interaction.options.getString("기업");
    const target = interaction.options.getUser("유저");
    const amount = interaction.options.getInteger("수량");
    const company = g.companies[name];

    if (!company) return replyPrivate("기업을 찾을 수 없습니다.");
    if (!officer && company.chairmanId !== uid) {
      return replyPrivate("해당 기업 회장 또는 경제관리자만 가능합니다.");
    }

    if (getShares(u, name) < amount) {
      return replyPrivate("보유 지분이 부족합니다.");
    }

    setShares(u, name, getShares(u, name) - amount);
    const targetUser = getUser(gid, target.id);
    setShares(targetUser, name, getShares(targetUser, name) + amount);

    saveData();

    return interaction.reply(
      `✅ ${target}에게 **${name}** 지분 ${amount}개를 지급했습니다.`
    );
  }

  // 지분 양도
  if (cmd === "지분양도") {
    const name = interaction.options.getString("기업");
    const target = interaction.options.getUser("유저");
    const amount = interaction.options.getInteger("수량");

    if (!g.companies[name]) return replyPrivate("기업을 찾을 수 없습니다.");
    if (target.bot || target.id === uid) {
      return replyPrivate("양도 대상을 확인하세요.");
    }
    if (getShares(u, name) < amount) {
      return replyPrivate("보유 지분이 부족합니다.");
    }

    setShares(u, name, getShares(u, name) - amount);
    const targetUser = getUser(gid, target.id);
    setShares(targetUser, name, getShares(targetUser, name) + amount);

    saveData();

    return interaction.reply(
      `🔁 ${target}에게 **${name}** 지분 ${amount}개를 양도했습니다.`
    );
  }

  // 지분 회수
  if (cmd === "지분회수") {
    const name = interaction.options.getString("기업");
    const target = interaction.options.getUser("유저");
    const amount = interaction.options.getInteger("수량");
    const company = g.companies[name];

    if (!company) return replyPrivate("기업을 찾을 수 없습니다.");
    if (!officer && company.chairmanId !== uid) {
      return replyPrivate("해당 기업 회장 또는 경제관리자만 가능합니다.");
    }

    const targetUser = getUser(gid, target.id);
    if (getShares(targetUser, name) < amount) {
      return replyPrivate("대상 보유 지분이 부족합니다.");
    }

    setShares(targetUser, name, getShares(targetUser, name) - amount);
    company.issuedShares = Math.max(0, company.issuedShares - amount);

    saveData();

    return interaction.reply(
      `♻️ ${target}의 **${name}** 지분 ${amount}개를 회수했습니다.`
    );
  }

  // 지분 현황
  if (cmd === "지분현황") {
    const name = interaction.options.getString("기업");
    const company = g.companies[name];

    if (!company) return replyPrivate("기업을 찾을 수 없습니다.");

    const holders = Object.entries(g.users)
      .map(([id, user]) => ({
        id,
        amount: getShares(user, name)
      }))
      .filter(x => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const total = holders.reduce((sum, x) => sum + x.amount, 0);

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${name} 지분 현황`)
      .setDescription(
        `👑 회장: <@${company.chairmanId}>\n` +
        `💵 지분 가격: ${money(company.sharePrice)}\n` +
        `📦 총 보유 지분: ${total}개`
      );

    if (!holders.length) {
      embed.addFields({
        name: "주주 목록",
        value: "보유 주주가 없습니다."
      });
    } else {
      embed.addFields({
        name: "주주 순위",
        value: holders.map((holder, index) => {
          const percent = total
            ? (holder.amount / total * 100).toFixed(4)
            : "0.0000";

          let badge = "";
          if (holder.id === company.chairmanId) badge = " 👑";
          else if (index === 0) badge = " 🥇";

          return `${index + 1}위 <@${holder.id}>${badge}\n` +
            `└ ${holder.amount}개 (${percent}%)`;
        }).join("\n")
      });
    }

    return interaction.reply({ embeds: [embed] });
  }

  // 배당금 지급
  if (cmd === "배당금") {
    const name = interaction.options.getString("기업");
    const totalMoney = toBigInt(interaction.options.getString("총액"));
    const company = g.companies[name];

    if (!company) return replyPrivate("기업을 찾을 수 없습니다.");
    if (!officer && company.chairmanId !== uid) {
      return replyPrivate("기업 회장 또는 경제관리자만 가능합니다.");
    }
    if (totalMoney <= 0n || toBigInt(u.cash) < totalMoney) {
      return replyPrivate("현금이 부족하거나 금액이 잘못되었습니다.");
    }

    const totalShares = totalCompanyShares(gid, name);
    if (totalShares <= 0) return replyPrivate("발행 지분이 없습니다.");

    u.cash = subMoney(u.cash, totalMoney);

    let distributed = 0n;
    const holders = Object.entries(g.users)
      .map(([id, user]) => ({
        id,
        amount: getShares(user, name)
      }))
      .filter(x => x.amount > 0);

    for (let i = 0; i < holders.length; i++) {
      const holder = holders[i];
      const user = getUser(gid, holder.id);
      const share = i === holders.length - 1
        ? totalMoney - distributed
        : totalMoney * BigInt(holder.amount) / BigInt(totalShares);

      user.cash = addMoney(user.cash, share);
      distributed += share;
    }

    saveData();

    return interaction.reply(
      `💸 **${name}** 배당금 ${money(totalMoney)} 지급 완료!`
    );
  }

  // 주식 추가
  if (cmd === "주식추가") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    const name = interaction.options.getString("이름").trim();
    const price = interaction.options.getInteger("가격");

    if (!name || g.stocks[name]) return replyPrivate("종목 이름이 잘못되었거나 중복됩니다.");

    g.stocks[name] = createStock(name, price);
    saveData();

    return interaction.reply(`📈 **${name}** 주식 생성 완료! 가격: ${money(price)}`);
  }

  // 주식 삭제
  if (cmd === "주식삭제") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    const name = interaction.options.getString("이름");
    if (!g.stocks[name]) return replyPrivate("종목을 찾을 수 없습니다.");

    delete g.stocks[name];
    for (const user of Object.values(g.users)) delete user.stocks[name];

    saveData();

    return interaction.reply(`🗑️ **${name}** 주식을 삭제했습니다.`);
  }

  // 주식 목록
  if (cmd === "주식목록") {
    const names = Object.values(g.stocks);

    if (!names.length) return interaction.reply("등록된 주식이 없습니다.");

    return interaction.reply(
      "📈 **주식 시장**\n" +
      names.map(stock =>
        `• **${stock.name}** — ${money(stock.price)}`
      ).join("\n") +
      `\n\n세율: ${g.taxRate}%`
    );
  }

  // 주식 구매
  if (cmd === "주식구매") {
    if (g.economyPaused) return replyPrivate("경제가 정지되어 주식 거래를 할 수 없습니다.");

    const name = interaction.options.getString("종목");
    const quantity = interaction.options.getInteger("수량");
    const stock = g.stocks[name];

    if (!stock) return replyPrivate("종목을 찾을 수 없습니다.");

    const cost = BigInt(stock.price) * BigInt(quantity);
    if (toBigInt(u.cash) < cost) return replyPrivate("현금이 부족합니다.");

    u.cash = subMoney(u.cash, cost);
    u.stocks[name] = Math.max(0, Number(u.stocks[name] || 0)) + quantity;

    saveData();

    return interaction.reply(
      `✅ **${name}** ${quantity}주 구매 완료.\n지불: ${money(cost)}`
    );
  }

  // 주식 판매
  if (cmd === "주식판매") {
    if (g.economyPaused) return replyPrivate("경제가 정지되어 주식 거래를 할 수 없습니다.");

    const name = interaction.options.getString("종목");
    const quantity = interaction.options.getInteger("수량");
    const stock = g.stocks[name];
    const held = Number(u.stocks[name] || 0);

    if (!stock) return replyPrivate("종목을 찾을 수 없습니다.");
    if (held < quantity) return replyPrivate("보유 주식이 부족합니다.");

    const gross = BigInt(stock.price) * BigInt(quantity);
    const tax = gross * BigInt(g.taxRate) / 100n;
    const net = gross - tax;

    u.stocks[name] = held - quantity;
    u.cash = addMoney(u.cash, net);

    saveData();

    return interaction.reply(
      `✅ **${name}** ${quantity}주 판매 완료.\n` +
      `판매금: ${money(gross)}\n세금: ${money(tax)}\n실수령: ${money(net)}`
    );
  }

  // 주가 변경
  if (cmd === "주가변경") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    const name = interaction.options.getString("종목");
    const price = interaction.options.getInteger("가격");

    if (!g.stocks[name]) return replyPrivate("종목을 찾을 수 없습니다.");

    g.stocks[name].price = price;
    g.stocks[name].updatedAt = Date.now();

    saveData();

    return interaction.reply(`📈 **${name}** 새 가격: ${money(price)}`);
  }

  // 세율 설정
  if (cmd === "세율설정") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    g.taxRate = interaction.options.getInteger("퍼센트");
    saveData();

    return interaction.reply(`💸 주식 판매 세율을 ${g.taxRate}%로 설정했습니다.`);
  }

  // 환전 신청
  if (cmd === "환전신청") {
    const amount = toBigInt(interaction.options.getString("금액"));

    if (amount <= 0n || toBigInt(u.cash) < amount) {
      return replyPrivate("현금이 부족하거나 금액이 잘못되었습니다.");
    }

    ensureExchangeNumber(g);
    const id = g.nextExchangeId++;

    g.exchangeRequests[id] = {
      id,
      userId: uid,
      amount: amount.toString(),
      status: "pending"
    };

    saveData();

    return interaction.reply({
      content: `💱 환전 신청 완료! 신청 번호: **${id}**\n관리자 승인 후 처리됩니다.`,
      ephemeral: true
    });
  }

  // 환전 승인
  if (cmd === "환전승인") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    const id = interaction.options.getInteger("번호");
    const rate = interaction.options.getInteger("환율");
    const request = g.exchangeRequests[id];

    if (!request || request.status !== "pending") {
      return replyPrivate("대기 중인 환전 신청이 없습니다.");
    }

    const requester = getUser(gid, request.userId);
    const amount = toBigInt(request.amount);

    if (toBigInt(requester.cash) < amount) {
      request.status = "cancelled";
      saveData();
      return replyPrivate("신청자의 현금이 부족하여 신청이 취소되었습니다.");
    }

    requester.cash = subMoney(requester.cash, amount);
    requester.bank = addMoney(requester.bank, amount * BigInt(rate));
    request.status = "approved";
    request.rate = rate;

    saveData();

    return interaction.reply(
      `✅ 환전 신청 #${id} 승인!\n` +
      `신청자: <@${request.userId}>\n` +
      `환율: ${rate}\n지급액: ${money(amount * BigInt(rate))}`
    );
  }

  // 환전 목록
  if (cmd === "환전목록") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    const requests = Object.values(g.exchangeRequests)
      .filter(r => r.status === "pending");

    return interaction.reply({
      content: requests.length
        ? requests.map(r =>
            `#${r.id} <@${r.userId}> — ${money(r.amount)}`
          ).join("\n")
        : "대기 중인 환전 신청이 없습니다.",
      ephemeral: true
    });
  }

  // 인플레이션 설정
  if (cmd === "인플레이션설정") {
    if (!admin && !officer) return replyPrivate("관리자 또는 경제관리자만 가능합니다.");

    g.inflation = interaction.options.getInteger("수치");
    g.economyPaused = g.inflation >= g.inflationLimit;

    saveData();

    return interaction.reply(
      `🌍 인플레이션: ${g.inflation}%\n` +
      `경제 상태: ${g.economyPaused ? "⛔ 정지" : "✅ 정상"}`
    );
  }

  // 경제 현황
  if (cmd === "경제현황") {
    return interaction.reply(
      `🌍 인플레이션: ${g.inflation}%\n` +
      `💸 주식 세율: ${g.taxRate}%\n` +
      `🏦 은행/주식 거래: ${g.economyPaused ? "정지" : "정상"}`
    );
  }

  // 자산 순위
  if (cmd === "자산순위") {
    const rank = Object.keys(g.users)
      .map(id => ({
        id,
        total: calculateAssets(gid, id)
      }))
      .sort((a, b) => a.total > b.total ? -1 : a.total < b.total ? 1 : 0)
      .slice(0, 10);

    return interaction.reply(
      rank.length
        ? "🏆 **자산 순위**\n" +
          rank.map((item, index) =>
            `${index + 1}위 <@${item.id}> — ${money(item.total.toString())}`
          ).join("\n")
        : "자산 데이터가 없습니다."
    );
  }
});

// 자동 주가 변동: 5분마다 각 종목 ±5%
setInterval(() => {
  for (const [gid, g] of Object.entries(data.guilds)) {
    for (const stock of Object.values(g.stocks || {})) {
      const movement = Math.random() < 0.5 ? -0.05 : 0.05;
      stock.price = Math.max(1, Math.round(stock.price * (1 + movement)));
      stock.updatedAt = Date.now();
    }
  }
  saveData();
}, 5 * 60 * 1000);

// 3/4 끝
// 4/4를 이 아래에 이어 붙이기
// ================================================
// 4/4: 명령어 등록 및 봇 실행
// ================================================

// 1~3/4의 명령어를 모두 합쳐 등록
const allCommands = [
  ...commands2,
  ...commands3
];

async function registerAllCommands() {
  try {
    const commandData = allCommands.map(command =>
      command.toJSON()
    );

    for (const [guildId] of Object.entries(data.guilds)) {
      // 기존 데이터가 있는 서버 명령어 등록
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guildId),
        { body: commandData }
      );
    }

    console.log("명령어 등록 완료");
  } catch (error) {
    console.error("명령어 등록 실패:", error);
  }
}

// 봇이 들어간 서버에도 명령어 등록
client.once("ready", async () => {
  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guild.id),
        { body: allCommands.map(command => command.toJSON()) }
      );

      console.log(`명령어 등록: ${guild.name}`);
    } catch (error) {
      console.error(
        `${guild.name} 명령어 등록 실패:`,
        error.message
      );
    }
  }
});

// 새 서버에 들어가면 해당 서버 명령어 등록
client.on("guildCreate", async guild => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guild.id),
      { body: allCommands.map(command => command.toJSON()) }
    );

    console.log(`${guild.name} 명령어 등록 완료`);
  } catch (error) {
    console.error("새 서버 명령어 등록 실패:", error);
  }
});

// 1분마다 데이터 저장
setInterval(() => {
  saveData();
}, 60 * 1000);

// 최종 실행
client.login(TOKEN).catch(error => {
  console.error("봇 로그인 실패:", error);
});
