const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
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

const elections = new Map();

const DATA_FILE = path.join(__dirname, "stock-data.json");

/* =========================================
   기본 데이터
========================================= */

const defaultData = {
  stocks: {
    "WB그룹": {
      price: 1000
    },
    "유마그룹": {
      price: 1000
    }
  },

  users: {},

  guilds: {}
};

/* =========================================
   돈 처리
========================================= */

function toBigIntAmount(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isSafeInteger(value)
    ) {
      throw new Error("INVALID_AMOUNT");
    }

    return BigInt(value);
  }

  const text = String(value)
    .replace(/,/g, "")
    .trim();

  if (!/^\d+$/.test(text)) {
    throw new Error("INVALID_AMOUNT");
  }

  return BigInt(text);
}

function money(value) {
  try {
    return toBigIntAmount(value).toLocaleString("ko-KR");
  } catch {
    return "0";
  }
}

function getCash(account) {
  try {
    return toBigIntAmount(account.cash ?? 0);
  } catch {
    account.cash = "0";
    return 0n;
  }
}

function getTaxFreeCash(account) {
  try {
    return toBigIntAmount(account.taxFreeCash ?? 0);
  } catch {
    account.taxFreeCash = "0";
    return 0n;
  }
}

function setCash(account, value) {
  account.cash =
    toBigIntAmount(value).toString();
}

function setTaxFreeCash(account, value) {
  account.taxFreeCash =
    toBigIntAmount(value).toString();
}

/* =========================================
   데이터 불러오기
========================================= */

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

    data.stocks["WB그룹"] ??= {
      price: 1000
    };

    data.stocks["유마그룹"] ??= {
      price: 1000
    };

    return data;

  } catch (error) {
    console.error(
      "❌ 데이터 불러오기 실패:",
      error
    );

    return structuredClone(defaultData);
  }
}

let data = loadData();

/* 기존 계정 보정 */

for (const account of Object.values(data.users)) {

  try {
    account.cash =
      toBigIntAmount(
        account.cash ?? 0
      ).toString();
  } catch {
    account.cash = "0";
  }

  try {
    account.taxFreeCash =
      toBigIntAmount(
        account.taxFreeCash ?? 0
      ).toString();
  } catch {
    account.taxFreeCash = "0";
  }

  account.holdings ??= {};
}

/* 기존 서버 설정 보정 */

for (const settings of Object.values(data.guilds)) {

  settings.adminRoleId ??= null;
  settings.logChannelId ??= null;
  settings.logRoleId ??= null;
  settings.startingCash ??= 10000;
  settings.taxRate ??= 10;
  settings.lastTaxAt ??= 0;
}

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      data,
      null,
      2
    )
  );
}

/* =========================================
   서버 설정
========================================= */

function getGuildSettings(guildId) {

  data.guilds[guildId] ??= {
    adminRoleId: null,
    logChannelId: null,
    logRoleId: null,
    startingCash: 10000,
    taxRate: 10,
    lastTaxAt: 0
  };

  return data.guilds[guildId];
}

/* =========================================
   사용자 계정
========================================= */

function getUserAccount(userId) {
  return data.users[userId] ?? null;
}

/* =========================================
   권한
========================================= */

function isServerAdmin(interaction) {

  return interaction.member?.permissions?.has(
    PermissionFlagsBits.Administrator
  );
}

function isStockAdmin(interaction) {

  if (isServerAdmin(interaction)) {
    return true;
  }

  const settings =
    getGuildSettings(
      interaction.guildId
    );

  if (!settings.adminRoleId) {
    return false;
  }

  return interaction.member.roles.cache.has(
    settings.adminRoleId
  );
}

/* =========================================
   로그
========================================= */

async function sendLog(
  interaction,
  title,
  description
) {

  const settings =
    getGuildSettings(
      interaction.guildId
    );

  if (!settings.logChannelId) {
    return;
  }

  const channel =
    interaction.guild.channels.cache.get(
      settings.logChannelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  const embed =
    new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

  await channel.send({
    embeds: [embed]
  }).catch(() => {});
}

/* =========================================
   슬래시 명령어
========================================= */

const commands = [

  /* ---------- 선거 ---------- */

  new SlashCommandBuilder()
    .setName("선거시작")
    .setDescription("새로운 선거를 시작합니다."),

  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("후보를 등록합니다.")
    .addStringOption(o =>
      o
        .setName("이름")
        .setDescription("후보 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("투표")
    .setDescription("후보에게 투표합니다.")
    .addStringOption(o =>
      o
        .setName("후보")
        .setDescription("후보 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("선거종료")
    .setDescription("현재 선거를 종료합니다."),

  new SlashCommandBuilder()
    .setName("결과")
    .setDescription("현재 선거 결과를 확인합니다."),

  /* ---------- 주식 ---------- */

  new SlashCommandBuilder()
    .setName("주식참여")
    .setDescription("가상 주식 게임에 참여합니다."),

  new SlashCommandBuilder()
    .setName("주식목록")
    .setDescription("현재 주식 목록을 확인합니다."),

  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("주식을 매수합니다.")
    .addStringOption(o =>
      o
        .setName("종목")
        .setDescription("종목 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o
        .setName("수량")
        .setDescription("수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("매도")
    .setDescription("주식을 매도합니다.")
    .addStringOption(o =>
      o
        .setName("종목")
        .setDescription("종목 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o
        .setName("수량")
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
    .setDescription("주식 자산 랭킹을 확인합니다."),

  /* ---------- 일반 돈 ---------- */

  new SlashCommandBuilder()
    .setName("돈추가")
    .setDescription("사용자에게 일반 돈을 추가합니다.")
    .addUserOption(o =>
      o
        .setName("대상")
        .setDescription("대상 사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("금액")
        .setDescription("추가 금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("돈제거")
    .setDescription("사용자의 일반 돈을 제거합니다.")
    .addUserOption(o =>
      o
        .setName("대상")
        .setDescription("대상 사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("금액")
        .setDescription("제거 금액")
        .setRequired(true)
    ),

  /* ---------- 면세 돈 ---------- */

  new SlashCommandBuilder()
    .setName("면세돈추가")
    .setDescription("세금 면제 돈을 추가합니다.")
    .addUserOption(o =>
      o
        .setName("대상")
        .setDescription("대상 사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("금액")
        .setDescription("면세 돈")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세돈제거")
    .setDescription("세금 면제 돈을 제거합니다.")
    .addUserOption(o =>
      o
        .setName("대상")
        .setDescription("대상 사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("금액")
        .setDescription("제거할 면세 돈")
        .setRequired(true)
    ),

  /* ---------- 주식 관리 ---------- */

  new SlashCommandBuilder()
    .setName("주식추가")
    .setDescription("주식 그룹을 추가합니다.")
    .addStringOption(o =>
      o
        .setName("이름")
        .setDescription("그룹 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o
        .setName("가격")
        .setDescription("시작 가격")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식삭제")
    .setDescription("주식 그룹을 삭제합니다.")
    .addStringOption(o =>
      o
        .setName("이름")
        .setDescription("그룹 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식가격")
    .setDescription("주식 가격을 변경합니다.")
    .addStringOption(o =>
      o
        .setName("이름")
        .setDescription("종목 이름")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o
        .setName("가격")
        .setDescription("새 가격")
        .setMinValue(1)
        .setRequired(true)
    ),

  /* ---------- 세금/주식 설정 ---------- */

  new SlashCommandBuilder()
    .setName("세금설정")
    .setDescription("자동 세율을 설정합니다.")
    .addIntegerOption(o =>
      o
        .setName("세율")
        .setDescription("0~100 사이 세율")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식설정")
    .setDescription("주식 시스템을 설정합니다.")

    .addSubcommand(s =>
      s
        .setName("관리자역할_생성")
        .setDescription("주식관리자 역할을 생성합니다.")
    )

    .addSubcommand(s =>
      s
        .setName("관리자역할_지정")
        .setDescription("주식관리자 역할을 지정합니다.")
        .addRoleOption(o =>
          o
            .setName("역할")
            .setDescription("역할")
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s
        .setName("관리자역할_삭제")
        .setDescription("주식관리자 역할을 삭제합니다.")
    )

    .addSubcommand(s =>
      s
        .setName("로그채널")
        .setDescription("로그 채널을 설정합니다.")
        .addChannelOption(o =>
          o
            .setName("채널")
            .setDescription("로그 채널")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s
        .setName("로그역할")
        .setDescription("로그 역할을 설정합니다.")
        .addRoleOption(o =>
          o
            .setName("역할")
            .setDescription("로그 역할")
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s
        .setName("시작금")
        .setDescription("신규 참가자 시작금")
        .addIntegerOption(o =>
          o
            .setName("금액")
            .setDescription("시작 금액")
            .setMinValue(0)
            .setRequired(true)
        )
    )

].map(c => c.toJSON());

/* =========================================
   봇 준비
========================================= */

client.once(
  "ready",
  async () => {

    console.log(
      `✅ ${client.user.tag} 로그인 완료!`
    );

    try {

      const rest =
        new REST({
          version: "10"
        }).setToken(TOKEN);

      await rest.put(
        Routes.applicationCommands(
          CLIENT_ID
        ),
        {
          body: commands
        }
      );

      console.log(
        "✅ 슬래시 명령어 등록 완료!"
      );

    } catch (error) {

      console.error(
        "❌ 명령어 등록 오류:",
        error
      );
    }
  }
);

/* =========================================
   명령어 처리
========================================= */

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const guildId =
      interaction.guildId;

    if (!guildId) {
      return interaction.reply(
        "❌ 서버에서만 사용할 수 있습니다."
      );
    }

    const command =
      interaction.commandName;

    /* =====================================
       선거 시작
    ===================================== */

    if (command === "선거시작") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      if (elections.get(guildId)?.active) {
        return interaction.reply(
          "❌ 이미 진행 중인 선거가 있습니다."
        );
      }

      elections.set(
        guildId,
        {
          active: true,
          candidates: new Map(),
          voters: new Set()
        }
      );

      return interaction.reply(
        "🗳️ **선거가 시작되었습니다!**\n" +
        "`/후보등록`으로 후보를 등록하세요."
      );
    }

    /* =====================================
       후보 등록
    ===================================== */

    if (command === "후보등록") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const election =
        elections.get(guildId);

      if (!election?.active) {
        return interaction.reply(
          "❌ 진행 중인 선거가 없습니다."
        );
      }

      if (election.candidates.size >= 20) {
        return interaction.reply(
          "❌ 후보는 최대 20명입니다."
        );
      }

      const name =
        interaction.options
          .getString("이름")
          .trim();

      if (election.candidates.has(name)) {
        return interaction.reply(
          "❌ 이미 등록된 후보입니다."
        );
      }

      election.candidates.set(
        name,
        0
      );

      return interaction.reply(
        `✅ **${name}** 후보 등록 완료!`
      );
    }

    /* =====================================
       투표
    ===================================== */

    if (command === "투표") {

      const election =
        elections.get(guildId);

      if (!election?.active) {
        return interaction.reply(
          "❌ 진행 중인 선거가 없습니다."
        );
      }

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

      if (!election.candidates.has(name)) {
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

    /* =====================================
       선거 종료
    ===================================== */

    if (command === "선거종료") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const election =
        elections.get(guildId);

      if (!election?.active) {
        return interaction.reply(
          "❌ 진행 중인 선거가 없습니다."
        );
      }

      election.active = false;

      return interaction.reply(
        "🛑 **선거가 종료되었습니다.**\n" +
        "`/결과`로 결과를 확인하세요."
      );
    }

    /* =====================================
       선거 결과
    ===================================== */

    if (command === "결과") {

      const election =
        elections.get(guildId);

      if (!election) {
        return interaction.reply(
          "❌ 아직 선거가 없습니다."
        );
      }

      const results =
        [...election.candidates.entries()]
          .sort(
            (a, b) =>
              b[1] - a[1]
          );

      if (!results.length) {
        return interaction.reply(
          "❌ 등록된 후보가 없습니다."
        );
      }

      let text =
        "📊 **선거 결과**\n\n";

      results.forEach(
        ([name, votes], index) => {

          text +=
            `${index + 1}. **${name}** — ${votes}표\n`;
        }
      );

      text +=
        `\n총 투표자: ${election.voters.size}명`;

      return interaction.reply(text);
    }

    /* =====================================
       주식 참여
    ===================================== */

    if (command === "주식참여") {

      if (
        getUserAccount(
          interaction.user.id
        )
      ) {
        return interaction.reply(
          "❌ 이미 주식 게임에 참여하고 있습니다."
        );
      }

      const settings =
        getGuildSettings(guildId);

      data.users[
        interaction.user.id
      ] = {

        cash:
          toBigIntAmount(
            settings.startingCash
          ).toString(),

        taxFreeCash: "0",

        holdings: {}
      };

      saveData();

      await interaction.reply(
        `✅ 주식 게임 참가 완료!\n` +
        `💰 시작금: **${money(settings.startingCash)}원**\n` +
        `🛡️ 면세돈: **0원**`
      );

      await sendLog(
        interaction,
        "📥 주식 참가",
        `${interaction.user} 님이 주식 게임에 참가했습니다.`
      );

      return;
    }

    /* =====================================
       주식 목록
    ===================================== */

    if (command === "주식목록") {

      let text =
        "📈 **현재 주식 목록**\n\n";

      for (
        const [name, stock]
        of Object.entries(data.stocks)
      ) {

        text +=
          `• **${name}** — ${money(stock.price)}원\n`;
      }

      return interaction.reply(text);
    }

    /* =====================================
       매수
       일반돈 + 면세돈 사용 가능
    ===================================== */

    if (command === "매수") {

      const account =
        getUserAccount(
          interaction.user.id
        );

      if (!account) {
        return interaction.reply(
          "❌ 먼저 `/주식참여`를 해주세요."
        );
      }

      const name =
        interaction.options
          .getString("종목")
          .trim();

      const amount =
        interaction.options
          .getInteger("수량");

      const stock =
        data.stocks[name];

      if (!stock) {
        return interaction.reply(
          "❌ 존재하지 않는 주식입니다."
        );
      }

      const total =
        BigInt(stock.price) *
        BigInt(amount);

      const normal =
        getCash(account);

      const taxFree =
        getTaxFreeCash(account);

      if (
        normal + taxFree < total
      ) {
        return interaction.reply(
          `❌ 돈이 부족합니다.\n` +
          `필요: **${money(total)}원**\n` +
          `일반돈: **${money(normal)}원**\n` +
          `면세돈: **${money(taxFree)}원**`
        );
      }

      /*
       일반돈을 먼저 사용하고
       부족하면 면세돈 사용
      */

      let normalUse = 0n;
      let taxFreeUse = 0n;

      if (normal >= total) {

        normalUse = total;

      } else {

        normalUse = normal;

        taxFreeUse =
          total - normal;
      }

      setCash(
        account,
        normal - normalUse
      );

      setTaxFreeCash(
        account,
        taxFree - taxFreeUse
      );

      account.holdings[name] =
        (account.holdings[name] || 0) +
        amount;

      saveData();

      await sendLog(
        interaction,
        "🟢 주식 매수",
        `${interaction.user} 님이 **${name}** ${amount}주 매수\n` +
        `거래금액: ${money(total)}원\n` +
        `일반돈 사용: ${money(normalUse)}원\n` +
        `면세돈 사용: ${money(taxFreeUse)}원`
      );

      return interaction.reply(
        `✅ **${name}** ${amount}주 매수 완료!\n\n` +
        `💸 거래금액: **${money(total)}원**\n` +
        `💰 일반돈 사용: **${money(normalUse)}원**\n` +
        `🛡️ 면세돈 사용: **${money(taxFreeUse)}원**\n\n` +
        `💰 일반돈: **${money(getCash(account))}원**\n` +
        `🛡️ 면세돈: **${money(getTaxFreeCash(account))}원**`
      );
    }

    /* =====================================
       매도
    ===================================== */

    if (command === "매도") {

      const account =
        getUserAccount(
          interaction.user.id
        );

      if (!account) {
        return interaction.reply(
          "❌ 먼저 `/주식참여`를 해주세요."
        );
      }

      const name =
        interaction.options
          .getString("종목")
          .trim();

      const amount =
        interaction.options
          .getInteger("수량");

      const stock =
        data.stocks[name];

      if (!stock) {
        return interaction.reply(
          "❌ 존재하지 않는 주식입니다."
        );
      }

      const owned =
        account.holdings[name] || 0;

      if (owned < amount) {
        return interaction.reply(
          `❌ 보유 주식이 부족합니다.\n` +
          `현재 보유: **${owned}주**`
        );
      }

      const total =
        BigInt(stock.price) *
        BigInt(amount);

      account.holdings[name] -=
        amount;

      /*
       매도금은 일반돈으로 지급
      */

      setCash(
        account,
        getCash(account) + total
      );

      saveData();

      await sendLog(
        interaction,
        "🔴 주식 매도",
        `${interaction.user} 님이 **${name}** ${amount}주 매도\n` +
        `판매금액: **${money(total)}원**`
      );

      return interaction.reply(
        `✅ **${name}** ${amount}주 매도 완료!\n` +
        `💰 ${money(total)}원 입금\n` +
        `💰 일반돈: **${money(getCash(account))}원**`
      );
    }

    /* =====================================
       잔액
    ===================================== */

    if (command === "잔액") {

      const account =
        getUserAccount(
          interaction.user.id
        );

      if (!account) {
        return interaction.reply(
          "❌ 먼저 `/주식참여`를 해주세요."
        );
      }

      const normal =
        getCash(account);

      const taxFree =
        getTaxFreeCash(account);

      return interaction.reply(
        `💰 **내 돈**\n\n` +
        `일반돈: **${money(normal)}원**\n` +
        `🛡️ 면세돈: **${money(taxFree)}원**\n` +
        `💎 총액: **${money(normal + taxFree)}원**`
      );
    }

    /* =====================================
       내 주식
    ===================================== */

    if (command === "내주식") {

      const account =
        getUserAccount(
          interaction.user.id
        );

      if (!account) {
        return interaction.reply(
          "❌ 먼저 `/주식참여`를 해주세요."
        );
      }

      let text =
        "📦 **내 주식**\n\n";

      let stockValue = 0n;

      for (
        const [name, amount]
        of Object.entries(
          account.holdings
        )
      ) {

        if (amount <= 0) {
          continue;
        }

        const price =
          data.stocks[name]
            ?.price || 0;

        const value =
          BigInt(price) *
          BigInt(amount);

        stockValue += value;

        text +=
          `• **${name}** — ${amount}주 ` +
          `(${money(value)}원)\n`;
      }

      const totalAssets =
        getCash(account) +
        getTaxFreeCash(account) +
        stockValue;

      text +=
        `\n💰 일반돈: ${money(getCash(account))}원`;

      text +=
        `\n🛡️ 면세돈: ${money(getTaxFreeCash(account))}원`;

      text +=
        `\n📈 주식가치: ${money(stockValue)}원`;

      text +=
        `\n💎 총 자산: **${money(totalAssets)}원**`;

      return interaction.reply(text);
    }

    /* =====================================
       주식 랭킹
    ===================================== */

    if (command === "주식랭킹") {

      const ranking =
        Object.entries(data.users)
          .map(
            ([userId, account]) => {

              let total =
                getCash(account) +
                getTaxFreeCash(account);

              for (
                const [name, amount]
                of Object.entries(
                  account.holdings
                )
              ) {

                total +=
                  BigInt(
                    data.stocks[name]
                      ?.price || 0
                  ) *
                  BigInt(amount);
              }

              return {
                userId,
                total
              };
            }
          )
          .sort(
            (a, b) =>
              a.total < b.total
                ? 1
                : a.total > b.total
                  ? -1
                  : 0
          );

      if (!ranking.length) {
        return interaction.reply(
          "❌ 참가자가 없습니다."
        );
      }

      let text =
        "🏆 **주식 자산 랭킹**\n\n";

      ranking
        .slice(0, 20)
        .forEach(
          (item, index) => {

            text +=
              `${index + 1}. <@${item.userId}> — **${money(item.total)}원**\n`;
          }
        );

      return interaction.reply(text);
    }

    /* =====================================
       돈 추가
    ===================================== */

    if (command === "돈추가") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ 서버 관리자만 사용할 수 있습니다.",
          ephemeral: true
        });
      }

      const target =
        interaction.options
          .getUser("대상");

      const raw =
        interaction.options
          .getString("금액")
          .replace(/,/g, "")
          .trim();

      let amount;

      try {
        amount =
          toBigIntAmount(raw);
      } catch {
        return interaction.reply({
          content:
            "❌ 금액은 숫자로 입력해주세요.",
          ephemeral: true
        });
      }

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "❌ 금액은 1 이상이어야 합니다.",
          ephemeral: true
        });
      }

      if (!data.users[target.id]) {

        data.users[target.id] = {
          cash: "0",
          taxFreeCash: "0",
          holdings: {}
        };
      }

      const account =
        data.users[target.id];

      setCash(
        account,
        getCash(account) + amount
      );

      saveData();

      await sendLog(
        interaction,
        "💰 돈 추가",
        `${interaction.user} → ${target}\n` +
        `추가: **${money(amount)}원**`
      );

      return interaction.reply(
        `✅ ${target} 님에게 **${money(amount)}원** 추가!\n` +
        `💰 현재 일반돈: **${money(getCash(account))}원**`
      );
    }

    /* =====================================
       돈 제거
    ===================================== */

    if (command === "돈제거") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ 서버 관리자만 사용할 수 있습니다.",
          ephemeral: true
        });
      }

      const target =
        interaction.options
          .getUser("대상");

      const raw =
        interaction.options
          .getString("금액")
          .replace(/,/g, "")
          .trim();

      let amount;

      try {
        amount =
          toBigIntAmount(raw);
      } catch {
        return interaction.reply({
          content:
            "❌ 금액은 숫자로 입력해주세요.",
          ephemeral: true
        });
      }

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "❌ 금액은 1 이상이어야 합니다.",
          ephemeral: true
        });
      }

      const account =
        data.users[target.id];

      if (!account) {
        return interaction.reply({
          content:
            "❌ 해당 사용자의 계정이 없습니다.",
          ephemeral: true
        });
      }

      const current =
        getCash(account);

      if (current < amount) {
        return interaction.reply({
          content:
            `❌ 일반돈이 부족합니다.\n` +
            `현재: **${money(current)}원**`,
          ephemeral: true
        });
      }

      setCash(
        account,
        current - amount
      );

      saveData();

      await sendLog(
        interaction,
        "💸 돈 제거",
        `${interaction.user} → ${target}\n` +
        `제거: **${money(amount)}원**`
      );

      return interaction.reply(
        `✅ ${target} 님의 일반돈 **${money(amount)}원** 제거!\n` +
        `💰 남은 일반돈: **${money(getCash(account))}원**`
      );
    }

    /* =====================================
       면세돈 추가
    ===================================== */

    if (command === "면세돈추가") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ 서버 관리자만 사용할 수 있습니다.",
          ephemeral: true
        });
      }

      const target =
        interaction.options
          .getUser("대상");

      const raw =
        interaction.options
          .getString("금액")
          .replace(/,/g, "")
          .trim();

      let amount;

      try {
        amount =
          toBigIntAmount(raw);
      } catch {
        return interaction.reply({
          content:
            "❌ 금액은 숫자로 입력해주세요.",
          ephemeral: true
        });
      }

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "❌ 금액은 1 이상이어야 합니다.",
          ephemeral: true
        });
      }

      if (!data.users[target.id]) {

        data.users[target.id] = {
          cash: "0",
          taxFreeCash: "0",
          holdings: {}
        };
      }

      const account =
        data.users[target.id];

      setTaxFreeCash(
        account,
        getTaxFreeCash(account) + amount
      );

      saveData();

      await sendLog(
        interaction,
        "🛡️ 면세돈 추가",
        `${interaction.user} → ${target}\n` +
        `면세돈: **${money(amount)}원**`
      );

      return interaction.reply(
        `✅ ${target} 님에게 면세돈 **${money(amount)}원** 추가!\n` +
        `🛡️ 현재 면세돈: **${money(getTaxFreeCash(account))}원**`
      );
    }

    /* =====================================
       면세돈 제거
    ===================================== */

    if (command === "면세돈제거") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ 서버 관리자만 사용할 수 있습니다.",
          ephemeral: true
        });
      }

      const target =
        interaction.options
          .getUser("대상");

      const raw =
        interaction.options
          .getString("금액")
          .replace(/,/g, "")
          .trim();

      let amount;

      try {
        amount =
          toBigIntAmount(raw);
      } catch {
        return interaction.reply({
          content:
            "❌ 금액은 숫자로 입력해주세요.",
          ephemeral: true
        });
      }

      if (amount <= 0n) {
        return interaction.reply({
          content:
            "❌ 금액은 1 이상이어야 합니다.",
          ephemeral: true
        });
      }

      const account =
        data.users[target.id];

      if (!account) {
        return interaction.reply({
          content:
            "❌ 해당 사용자의 계정이 없습니다.",
          ephemeral: true
        });
      }

      const current =
        getTaxFreeCash(account);

      if (current < amount) {
        return interaction.reply({
          content:
            `❌ 면세돈이 부족합니다.\n` +
            `현재: **${money(current)}원**`,
          ephemeral: true
        });
      }

      setTaxFreeCash(
        account,
        current - amount
      );

      saveData();

      await sendLog(
        interaction,
        "🛡️ 면세돈 제거",
        `${interaction.user} → ${target}\n` +
        `제거: **${money(amount)}원**`
      );

      return interaction.reply(
        `✅ ${target} 님의 면세돈 **${money(amount)}원** 제거!\n` +
        `🛡️ 남은 면세돈: **${money(getTaxFreeCash(account))}원**`
      );
    }

    /* =====================================
       주식 추가
    ===================================== */

    if (command === "주식추가") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
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

      if (data.stocks[name]) {
        return interaction.reply(
          "❌ 이미 존재하는 주식입니다."
        );
      }

      data.stocks[name] = {
        price
      };

      saveData();

      await sendLog(
        interaction,
        "➕ 주식 추가",
        `${interaction.user} 님이 **${name}** 추가\n` +
        `가격: **${money(price)}원**`
      );

      return interaction.reply(
        `✅ **${name}** 추가 완료!\n` +
        `가격: **${money(price)}원**`
      );
    }

    /* =====================================
       주식 삭제
    ===================================== */

    if (command === "주식삭제") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

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

      const holders =
        Object.values(data.users)
          .some(
            account =>
              (account.holdings[name] || 0) > 0
          );

      if (holders) {
        return interaction.reply(
          "❌ 누군가 보유 중이라 삭제할 수 없습니다."
        );
      }

      delete data.stocks[name];

      saveData();

      return interaction.reply(
        `✅ **${name}** 삭제 완료!`
      );
    }

    /* =====================================
       주식 가격
    ===================================== */

    if (command === "주식가격") {

      if (!isStockAdmin(interaction)) {
        return interaction.reply(
          "❌ 주식관리자만 사용할 수 있습니다."
        );
      }

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

      const oldPrice =
        data.stocks[name].price;

      data.stocks[name].price =
        price;

      saveData();

      await sendLog(
        interaction,
        "💹 주가 변경",
        `**${name}**\n` +
        `${money(oldPrice)}원 → **${money(price)}원**`
      );

      return interaction.reply(
        `✅ **${name}** 가격 변경!\n` +
        `${money(oldPrice)}원 → **${money(price)}원**`
      );
    }

    /* =====================================
       세금 설정
    ===================================== */

    if (command === "세금설정") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      const rate =
        interaction.options
          .getInteger("세율");

      const settings =
        getGuildSettings(guildId);

      settings.taxRate =
        rate;

      saveData();

      return interaction.reply(
        `✅ 자동 세율을 **${rate}%**로 설정했습니다.`
      );
    }

    /* =====================================
       주식 설정
    ===================================== */

    if (command === "주식설정") {

      if (!isServerAdmin(interaction)) {
        return interaction.reply(
          "❌ 서버 관리자만 설정할 수 있습니다."
        );
      }

      const sub =
        interaction.options
          .getSubcommand();

      const settings =
        getGuildSettings(guildId);

      /* 관리자 역할 생성 */

      if (sub === "관리자역할_생성") {

        if (settings.adminRoleId) {
          return interaction.reply(
            "❌ 이미 주식관리자 역할이 있습니다."
          );
        }

        try {

          const role =
            await interaction.guild.roles.create({
              name: "주식관리자",
              color: 0x2ecc71,
              reason:
                "주식 시스템 관리자 역할"
            });

          settings.adminRoleId =
            role.id;

          saveData();

          return interaction.reply(
            `✅ ${role} 역할 생성 완료!`
          );

        } catch {

          return interaction.reply(
            "❌ 역할 생성 실패!\n" +
            "봇에게 역할 관리 권한이 필요합니다."
          );
        }
      }

      /* 관리자 역할 지정 */

      if (sub === "관리자역할_지정") {

        const role =
          interaction.options
            .getRole("역할");

        settings.adminRoleId =
          role.id;

        saveData();

        return interaction.reply(
          `✅ ${role} 을(를) 주식관리자로 지정했습니다.`
        );
      }

      /* 관리자 역할 삭제 */

      if (sub === "관리자역할_삭제") {

        settings.adminRoleId =
          null;

        saveData();

        return interaction.reply(
          "✅ 주식관리자 설정을 삭제했습니다."
        );
      }

      /* 로그 채널 */

      if (sub === "로그채널") {

        const channel =
          interaction.options
            .getChannel("채널");

        settings.logChannelId =
          channel.id;

        saveData();

        return interaction.reply(
          `✅ ${channel} 로그 채널 설정 완료!`
        );
      }

      /* 로그 역할 */

      if (sub === "로그역할") {

        const role =
          interaction.options
            .getRole("역할");

        settings.logRoleId =
          role.id;

        saveData();

        return interaction.reply(
          `✅ ${role} 로그 역할 설정 완료!`
        );
      }

      /* 시작금 */

      if (sub === "시작금") {

        const amount =
          interaction.options
            .getInteger("금액");

        settings.startingCash =
          amount;

        saveData();

        return interaction.reply(
          `✅ 신규 참가자 시작금: **${money(amount)}원**`
        );
      }
    }
  }
);

/* =========================================
   자동 세금
   24시간마다 서버별 부과
========================================= */

async function collectTaxes() {

  const now =
    Date.now();

  let changed = false;

  for (
    const [guildId, settings]
    of Object.entries(data.guilds)
  ) {

    const last =
      Number(settings.lastTaxAt || 0);

    /*
      마지막 세금 부과 후
      24시간이 지나지 않았다면 패스
    */

    if (
      last !== 0 &&
      now - last < 24 * 60 * 60 * 1000
    ) {
      continue;
    }

    const rate =
      Number(settings.taxRate ?? 10);

    if (rate <= 0) {
      settings.lastTaxAt =
        now;

      changed = true;

      continue;
    }

    let totalTax = 0n;

    /*
      현재 구조에서는 계정이
      서버별로 분리되어 있지 않기 때문에
      서버에 실제로 있는 사용자만 과세
    */

    try {

      const guild =
        await client.guilds.fetch(
          guildId
        );

      for (
        const account
        of Object.values(data.users)
      ) {

        /*
          일반돈만 과세
          면세돈은 완전히 제외
        */

        const normal =
          getCash(account);

        if (normal <= 0n) {
          continue;
        }

        const tax =
          (normal * BigInt(rate)) /
          100n;

        if (tax <= 0n) {
          continue;
        }

        setCash(
          account,
          normal - tax
        );

        totalTax += tax;
        changed = true;
      }

      settings.lastTaxAt =
        now;

      if (totalTax > 0n) {

        const channel =
          settings.logChannelId
            ? guild.channels.cache.get(
                settings.logChannelId
              )
            : null;

        if (
          channel &&
          channel.isTextBased()
        ) {

          const embed =
            new EmbedBuilder()
              .setTitle("🧾 자동 세금 징수")
              .setDescription(
                `세율: **${rate}%**\n` +
                `총 징수액: **${money(totalTax)}원**\n\n` +
                `🛡️ 면세돈에는 세금이 부과되지 않았습니다.`
              )
              .setTimestamp();

          await channel.send({
            embeds: [embed]
          }).catch(() => {});
        }
      }

    } catch (error) {

      console.error(
        `세금 처리 실패 (${guildId}):`,
        error
      );
    }
  }

  if (changed) {
    saveData();
  }
}

/*
  1분마다 확인해서
  24시간이 지나면 자동 세금
*/

setInterval(
  () => {
    collectTaxes()
      .catch(console.error);
  },
  60 * 1000
);

/* =========================================
   자동 주가
   5분마다 ±5%
========================================= */

setInterval(
  () => {

    try {

      for (
        const stock
        of Object.values(data.stocks)
      ) {

        const percent =
          Math.random() * 10 - 5;

        const oldPrice =
          Number(stock.price);

        const newPrice =
          Math.max(
            1,
            Math.round(
              oldPrice *
              (1 + percent / 100)
            )
          );

        stock.price =
          newPrice;
      }

      saveData();

      console.log(
        "📈 자동 주가 변동 완료"
      );

    } catch (error) {

      console.error(
        "❌ 자동 주가 변동 오류:",
        error
      );
    }

  },
  5 * 60 * 1000
);

/* =========================================
   웹 서버
========================================= */

const app =
  express();

app.get(
  "/",
  (req, res) => {
    res.send(
      "Discord Election + Stock + Tax Bot is running!"
    );
  }
);

app.listen(
  process.env.PORT || 3000,
  () => {
    console.log(
      "🌐 웹 서버 실행!"
    );
  }
);

/* =========================================
   로그인
========================================= */

client.login(TOKEN);
