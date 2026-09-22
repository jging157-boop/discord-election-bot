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
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN 또는 CLIENT_ID가 없습니다.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const DATA_FILE = path.join(__dirname, "stock-data.json");

const SMALL_MIN = 2000;
const LARGE_MIN = 10000;
const SMALL_MAX = 20;
const LARGE_MAX = 50;
const MAX_SMALL_STOCKS = 20;
const DEFAULT_TAX = 20;

let data = {
  users: {},
  stocks: {
    WB그룹: { price: 1000, type: "small" },
    유마그룹: { price: 1000, type: "small" },
  },
  guilds: {},
};

const elections = new Map();

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

      data.users = saved.users || {};
      data.stocks = saved.stocks || data.stocks;
      data.guilds = saved.guilds || {};
    }
  } catch (e) {
    console.error("데이터 불러오기 오류:", e);
  }

  for (const stock of Object.values(data.stocks)) {
    if (typeof stock === "number") {
      stock.price = stock;
      stock.type = "small";
    }

    stock.price = Number(stock.price) || 1;
    stock.type = stock.type === "large" ? "large" : "small";
  }

  saveData();
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("데이터 저장 오류:", e);
  }
}

loadData();

function guildData(id) {
  if (!data.guilds[id]) {
    data.guilds[id] = {
      taxRate: DEFAULT_TAX,
      logChannelId: null,
      menuChannelId: null,
      menuMessageId: null,
    };
  }

  return data.guilds[id];
}

function account(id) {
  if (!data.users[id]) {
    data.users[id] = {
      money: "0",
      taxFreeMoney: "0",
      stocks: {},
      taxFreeStocks: {},
    };
  }

  const a = data.users[id];

  a.money = String(a.money ?? "0");
  a.taxFreeMoney = String(a.taxFreeMoney ?? "0");
  a.stocks = a.stocks || {};
  a.taxFreeStocks = a.taxFreeStocks || {};

  return a;
}

function admin(i) {
  return i.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function money(n) {
  return BigInt(n).toLocaleString("ko-KR");
}

function tax(guildId, amount) {
  const rate = BigInt(guildData(guildId).taxRate);
  return (BigInt(amount) * rate) / 100n;
}

async function answer(i, text, deleteAfter = true) {
  try {
    if (!i.replied && !i.deferred) {
      await i.reply({ content: text });
    } else {
      await i.editReply({ content: text });
    }

    if (deleteAfter) {
      setTimeout(() => {
        i.deleteReply().catch(() => {});
      }, 10000);
    }
  } catch {}
}

async function log(guildId, title, text) {
  try {
    const id = guildData(guildId).logChannelId;
    if (!id) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(id);
    if (!channel?.isTextBased()) return;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(text)
          .setTimestamp(),
      ],
    });
  } catch (e) {
    console.error("로그 오류:", e);
  }
}

function stockText(guildId) {
  const settings = guildData(guildId);

  let text =
    `🧾 현재 세율: **${settings.taxRate}%**\n` +
    `소형 최소: **${money(SMALL_MIN)}원**\n` +
    `대형 최소: **${money(LARGE_MIN)}원**\n\n`;

  const stocks = Object.entries(data.stocks);

  if (!stocks.length) return text + "주식이 없습니다.";

  for (const [name, s] of stocks) {
    text +=
      `**${name}**\n` +
      `가격: ${money(s.price)}원\n` +
      `종류: ${s.type === "large" ? "대형" : "소형"}\n\n`;
  }

  return text;
}

function stockButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("buy")
        .setLabel("일반돈 매수")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("taxbuy")
        .setLabel("면세돈 매수")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("sell")
        .setLabel("일반돈 매도")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("taxsell")
        .setLabel("면세매도")
        .setStyle(ButtonStyle.Danger)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("wallet")
        .setLabel("내 지갑")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("mine")
        .setLabel("내 주식")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("list")
        .setLabel("주식 목록")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("ranking")
        .setLabel("주식 랭킹")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function updateMenu(guildId) {
  const g = guildData(guildId);

  if (!g.menuChannelId || !g.menuMessageId) return;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(g.menuChannelId);
    if (!channel?.isTextBased()) return;

    const msg = await channel.messages
      .fetch(g.menuMessageId)
      .catch(() => null);

    if (!msg) return;

    await msg.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏦 주식 거래소")
          .setDescription(stockText(guildId))
          .setTimestamp(),
      ],
      components: stockButtons(),
    });
  } catch (e) {
    console.error("메뉴 업데이트 오류:", e);
  }
}

async function updateAllMenus() {
  for (const guild of client.guilds.cache.values()) {
    await updateMenu(guild.id);
  }
}

function modal(id, title, fields) {
  const m = new ModalBuilder()
    .setCustomId(id)
    .setTitle(title);

  for (const [name, label, placeholder] of fields) {
    m.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(name)
          .setLabel(label)
          .setPlaceholder(placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  }

  return m;
}

async function buy(i, name, qty, taxFree) {
  const s = data.stocks[name];

  if (!s) return answer(i, "❌ 존재하지 않는 주식입니다.");

  qty = Number(qty);

  if (!Number.isInteger(qty) || qty <= 0) {
    return answer(i, "❌ 수량이 올바르지 않습니다.");
  }

  const max = s.type === "large" ? LARGE_MAX : SMALL_MAX;

  if (qty > max) {
    return answer(i, `❌ 한 번에 최대 ${max}주까지 가능합니다.`);
  }

  const total = BigInt(s.price) * BigInt(qty);
  const minimum = s.type === "large" ? LARGE_MIN : SMALL_MIN;

  if (total < BigInt(minimum)) {
    return answer(i, `❌ 최소 매수금액은 ${money(minimum)}원입니다.`);
  }

  const a = account(i.user.id);
  const key = taxFree ? "taxFreeMoney" : "money";

  const t = taxFree ? 0n : tax(i.guildId, total);
  const finalPrice = total + t;

  if (BigInt(a[key]) < finalPrice) {
    return answer(i, "❌ 돈이 부족합니다.");
  }

  a[key] = (BigInt(a[key]) - finalPrice).toString();

  const stocksKey = taxFree ? "taxFreeStocks" : "stocks";

  a[stocksKey][name] =
    Number(a[stocksKey][name] || 0) + qty;

  saveData();

  await log(
    i.guildId,
    taxFree ? "🛡️ 면세 매수" : "📈 매수",
    `사용자: ${i.user}\n종목: **${name}**\n수량: **${qty}주**\n금액: **${money(total)}원**\n세금: **${money(t)}원**`
  );

  await answer(
    i,
    `✅ ${name} ${qty}주 매수 완료\n총액: ${money(finalPrice)}원`
  );

  await updateAllMenus();
}

async function sell(i, name, qty, taxFree) {
  const s = data.stocks[name];

  if (!s) return answer(i, "❌ 존재하지 않는 주식입니다.");

  qty = Number(qty);

  if (!Number.isInteger(qty) || qty <= 0) {
    return answer(i, "❌ 수량이 올바르지 않습니다.");
  }

  const a = account(i.user.id);
  const key = taxFree ? "taxFreeStocks" : "stocks";

  const owned = Number(a[key][name] || 0);

  if (owned < qty) {
    return answer(i, `❌ 보유 주식이 부족합니다. 현재 ${owned}주`);
  }

  const gross = BigInt(s.price) * BigInt(qty);
  const t = taxFree ? 0n : tax(i.guildId, gross);
  const received = gross - t;

  a[key][name] = owned - qty;

  if (a[key][name] <= 0) delete a[key][name];

  const moneyKey = taxFree ? "taxFreeMoney" : "money";

  a[moneyKey] =
    (BigInt(a[moneyKey]) + received).toString();

  saveData();

  await log(
    i.guildId,
    taxFree ? "🛡️ 면세 매도" : "📉 매도",
    `사용자: ${i.user}\n종목: **${name}**\n수량: **${qty}주**\n판매액: **${money(gross)}원**\n세금: **${money(t)}원**\n받은돈: **${money(received)}원**`
  );

  await answer(
    i,
    `✅ ${name} ${qty}주 매도 완료\n받은 돈: ${money(received)}원`
  );

  await updateAllMenus();
}

const commands = [
  ["선거시작", "선거 시작"],
  ["선거종료", "선거 종료"],
  ["결과", "선거 결과"],
  ["주식참여", "주식 참여"],
  ["주식목록", "주식 목록"],
  ["주식메뉴", "주식 메뉴"],
  ["잔액", "잔액 확인"],
  ["내주식", "내 주식"],
  ["주식랭킹", "주식 랭킹"],
  ["관리자메뉴", "관리자 메뉴"],
].map(([name, description]) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .toJSON()
);

commands.push(
  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("후보 등록")
    .addStringOption(o =>
      o.setName("이름").setDescription("후보 이름").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("투표")
    .setDescription("투표")
    .addStringOption(o =>
      o.setName("후보").setDescription("후보 이름").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("주식 매수")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("면세매수")
    .setDescription("면세 매수")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("매도")
    .setDescription("주식 매도")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("면세매도")
    .setDescription("면세 매도")
    .addStringOption(o =>
      o.setName("종목").setDescription("종목").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량").setDescription("수량").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("세금률설정")
    .setDescription("세율 설정")
    .addIntegerOption(o =>
      o.setName("세율")
        .setDescription("0~100")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("로그채널")
    .setDescription("로그 채널 설정")
    .addChannelOption(o =>
      o.setName("채널").setDescription("로그 채널").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("주식추가")
    .setDescription("주식 추가")
    .addStringOption(o =>
      o.setName("이름").setDescription("이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("가격").setDescription("가격").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("종류")
        .setDescription("small 또는 large")
        .setRequired(true)
        .addChoices(
          { name: "소형", value: "small" },
          { name: "대형", value: "large" }
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("주식삭제")
    .setDescription("주식 삭제")
    .addStringOption(o =>
      o.setName("이름").setDescription("이름").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("주식가격")
    .setDescription("주가 변경")
    .addStringOption(o =>
      o.setName("이름").setDescription("이름").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("가격").setDescription("가격").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("돈추가")
    .setDescription("돈 추가")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("돈제거")
    .setDescription("돈 제거")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("면세돈추가")
    .setDescription("면세돈 추가")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("면세돈제거")
    .setDescription("면세돈 제거")
    .addUserOption(o =>
      o.setName("사용자").setDescription("사용자").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액").setDescription("금액").setRequired(true)
    )
    .toJSON()
);

client.once("ready", async () => {
  console.log(`✅ 로그인 성공: ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guild.id),
        { body: commands }
      );

      console.log(`✅ 명령어 등록: ${guild.name}`);
    } catch (e) {
      console.error(`❌ 명령어 등록 실패: ${guild.name}`, e.message);
    }
  }
});

client.on("guildCreate", async guild => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guild.id),
      { body: commands }
    );
  } catch (e) {
    console.error("서버 명령어 등록 오류:", e.message);
  }
});

client.on("interactionCreate", async i => {
  try {
    /* 버튼 */
    if (i.isButton()) {
      if (
        ["buy", "taxbuy", "sell", "taxsell"].includes(i.customId)
      ) {
        const titles = {
          buy: "일반돈 매수",
          taxbuy: "면세돈 매수",
          sell: "일반돈 매도",
          taxsell: "면세 주식 매도",
        };

        await i.showModal(
          modal(
            `trade_${i.customId}`,
            titles[i.customId],
            [
              ["stock", "주식 이름", "예: WB그룹"],
              ["qty", "수량", "예: 5"],
            ]
          )
        );

        return;
      }

      if (i.customId === "wallet") {
        const a = account(i.user.id);

        return i.reply({
          content:
            `💰 일반돈: **${money(a.money)}원**\n` +
            `🛡️ 면세돈: **${money(a.taxFreeMoney)}원**`,
          ephemeral: true,
        });
      }

      if (i.customId === "mine") {
        const a = account(i.user.id);

        let text = "📊 **내 주식**\n\n";

        for (const [name, qty] of Object.entries(a.stocks)) {
          text += `📈 ${name}: ${qty}주\n`;
        }

        for (const [name, qty] of Object.entries(a.taxFreeStocks)) {
          text += `🛡️ ${name}: ${qty}주\n`;
        }

        if (text === "📊 **내 주식**\n\n") {
          text += "보유 주식이 없습니다.";
        }

        return i.reply({
          content: text,
          ephemeral: true,
        });
      }

      if (i.customId === "list") {
        return i.reply({
          content: stockText(i.guildId),
          ephemeral: true,
        });
      }

      if (i.customId === "ranking") {
        const users = Object.entries(data.users)
          .map(([id, a]) => {
            let total =
              BigInt(a.money || 0) +
              BigInt(a.taxFreeMoney || 0);

            for (const [name, qty] of Object.entries(a.stocks || {})) {
              if (data.stocks[name]) {
                total += BigInt(data.stocks[name].price) * BigInt(qty);
              }
            }

            for (const [name, qty] of Object.entries(
              a.taxFreeStocks || {}
            )) {
              if (data.stocks[name]) {
                total += BigInt(data.stocks[name].price) * BigInt(qty);
              }
            }

            return { id, total };
          })
          .sort((a, b) => (a.total > b.total ? -1 : 1))
          .slice(0, 10);

        let text = "🏆 **주식 랭킹**\n\n";

        users.forEach((u, n) => {
          text += `${n + 1}. <@${u.id}> — **${money(u.total)}원**\n`;
        });

        return i.reply({
          content: text,
          ephemeral: true,
        });
      }

      if (i.customId === "admin_tax") {
        if (!admin(i))
          return i.reply({
            content: "❌ 관리자만 사용 가능합니다.",
            ephemeral: true,
          });

        return i.showModal(
          modal("tax_modal", "세율 설정", [
            ["rate", "세율", "예: 20"],
          ])
        );
      }
    }

    /* 모달 */
    if (i.isModalSubmit()) {
      if (i.customId.startsWith("trade_")) {
        const type = i.customId.replace("trade_", "");
        const name = i.fields.getTextInputValue("stock");
        const qty = i.fields.getTextInputValue("qty");

        if (type === "buy") return buy(i, name, qty, false);
        if (type === "taxbuy") return buy(i, name, qty, true);
        if (type === "sell") return sell(i, name, qty, false);
        if (type === "taxsell") return sell(i, name, qty, true);
      }

      if (i.customId === "tax_modal") {
        if (!admin(i))
          return i.reply({
            content: "❌ 관리자만 사용 가능합니다.",
            ephemeral: true,
          });

        const rate = Number(i.fields.getTextInputValue("rate"));

        if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
          return answer(i, "❌ 세율은 0~100%입니다.");
        }

        const old = guildData(i.guildId).taxRate;
        guildData(i.guildId).taxRate = rate;
        saveData();

        await log(
          i.guildId,
          "🧾 세율 변경",
          `관리자: ${i.user}\n기존: **${old}%**\n변경: **${rate}%**`
        );

        await answer(i, `✅ 세율이 ${rate}%로 변경되었습니다.`);
        return updateAllMenus();
      }
    }

    if (!i.isChatInputCommand()) return;

    const name = i.commandName;

    const adminCommands = [
      "선거시작",
      "선거종료",
      "결과",
      "후보등록",
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
      "관리자메뉴",
    ];

    if (adminCommands.includes(name) && !admin(i)) {
      return answer(i, "❌ 관리자만 사용할 수 있습니다.");
    }

    if (name === "주식메뉴") {
      const msg = await i.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏦 주식 거래소")
            .setDescription(stockText(i.guildId))
            .setTimestamp(),
        ],
        components: stockButtons(),
      });

      const g = guildData(i.guildId);

      g.menuChannelId = i.channelId;
      g.menuMessageId = msg.id;

      saveData();

      return answer(i, "✅ 주식 메뉴를 만들었습니다.");
    }

    if (name === "주식목록") {
      return i.reply({
        content: stockText(i.guildId),
        ephemeral: true,
      });
    }

    if (name === "주식참여") {
      account(i.user.id);
      saveData();

      return i.reply({
        content: "✅ 주식 참여 완료!",
        ephemeral: true,
      });
    }

    if (name === "잔액") {
      const a = account(i.user.id);

      return i.reply({
        content:
          `💰 일반돈: **${money(a.money)}원**\n` +
          `🛡️ 면세돈: **${money(a.taxFreeMoney)}원**`,
        ephemeral: true,
      });
    }

    if (name === "내주식") {
      const a = account(i.user.id);

      let text = "📊 **내 주식**\n\n";

      for (const [n, q] of Object.entries(a.stocks)) {
        text += `📈 ${n}: ${q}주\n`;
      }

      for (const [n, q] of Object.entries(a.taxFreeStocks)) {
        text += `🛡️ ${n}: ${q}주\n`;
      }

      return i.reply({
        content: text,
        ephemeral: true,
      });
    }

    if (name === "주식랭킹") {
      return i.reply({
        content: "🏆 랭킹은 거래소의 **주식 랭킹** 버튼을 이용하세요.",
        ephemeral: true,
      });
    }

    if (name === "매수") {
      return buy(
        i,
        i.options.getString("종목"),
        i.options.getInteger("수량"),
        false
      );
    }

    if (name === "면세매수") {
      return buy(
        i,
        i.options.getString("종목"),
        i.options.getInteger("수량"),
        true
      );
    }

    if (name === "매도") {
      return sell(
        i,
        i.options.getString("종목"),
        i.options.getInteger("수량"),
        false
      );
    }

    if (name === "면세매도") {
      return sell(
        i,
        i.options.getString("종목"),
        i.options.getInteger("수량"),
        true
      );
    }

    /* 선거 */
    if (name === "선거시작") {
      elections.set(i.guildId, {
        active: true,
        candidates: {},
        voters: {},
      });

      await log(
        i.guildId,
        "🗳️ 선거 시작",
        `관리자: ${i.user}`
      );

      return answer(i, "✅ 선거가 시작되었습니다.");
    }

    if (name === "후보등록") {
      const e = elections.get(i.guildId);

      if (!e?.active)
        return answer(i, "❌ 진행 중인 선거가 없습니다.");

      const candidate = i.options.getString("이름");

      if (Object.keys(e.candidates).length >= 20)
        return answer(i, "❌ 후보는 최대 20명입니다.");

      if (e.candidates[candidate] !== undefined)
        return answer(i, "❌ 이미 등록된 후보입니다.");

      e.candidates[candidate] = 0;

      await log(
        i.guildId,
        "📝 후보 등록",
        `후보: **${candidate}**\n관리자: ${i.user}`
      );

      return answer(i, `✅ ${candidate} 후보 등록 완료`);
    }

    if (name === "투표") {
      const e = elections.get(i.guildId);

      if (!e?.active)
        return answer(i, "❌ 진행 중인 선거가 없습니다.");

      const candidate = i.options.getString("후보");

      if (e.candidates[candidate] === undefined)
        return answer(i, "❌ 존재하지 않는 후보입니다.");

      if (e.voters[i.user.id])
        return answer(i, "❌ 이미 투표했습니다.");

      e.voters[i.user.id] = candidate;
      e.candidates[candidate]++;

      await log(
        i.guildId,
        "🗳️ 투표",
        `사용자: ${i.user}\n후보: **${candidate}**`
      );

      return answer(i, `✅ ${candidate} 후보에게 투표했습니다.`);
    }

    if (name === "선거종료") {
      const e = elections.get(i.guildId);

      if (!e?.active)
        return answer(i, "❌ 진행 중인 선거가 없습니다.");

      e.active = false;

      await log(
        i.guildId,
        "🛑 선거 종료",
        `관리자: ${i.user}`
      );

      return answer(i, "✅ 선거가 종료되었습니다.");
    }

    if (name === "결과") {
      const e = elections.get(i.guildId);

      if (!e)
        return answer(i, "❌ 선거가 없습니다.");

      const result = Object.entries(e.candidates)
        .sort((a, b) => b[1] - a[1])
        .map(([n, v], x) =>
          `${x + 1}. **${n}** — ${v}표`
        )
        .join("\n");

      return answer(
        i,
        `📊 **선거 결과**\n\n${result || "후보가 없습니다."}`
      );
    }

    /* 관리자 */
    if (name === "세금률설정") {
      const rate = i.options.getInteger("세율");

      guildData(i.guildId).taxRate = rate;
      saveData();

      await log(
        i.guildId,
        "🧾 세율 변경",
        `관리자: ${i.user}\n새 세율: **${rate}%**`
      );

      await answer(i, `✅ 세율 ${rate}% 설정 완료`);
      return updateAllMenus();
    }

    if (name === "로그채널") {
      const channel = i.options.getChannel("채널");

      guildData(i.guildId).logChannelId = channel.id;
      saveData();

      return answer(i, `✅ 로그 채널을 ${channel}로 설정했습니다.`);
    }

    if (name === "주식추가") {
      const stockName = i.options.getString("이름");
      const price = i.options.getInteger("가격");
      const type = i.options.getString("종류");

      if (data.stocks[stockName])
        return answer(i, "❌ 이미 존재하는 주식입니다.");

      const smallCount = Object.values(data.stocks)
        .filter(x => x.type === "small").length;

      if (type === "small" && smallCount >= MAX_SMALL_STOCKS)
        return answer(i, "❌ 소형 주식은 최대 20종목입니다.");

      data.stocks[stockName] = {
        price,
        type,
      };

      saveData();

      await log(
        i.guildId,
        "➕ 주식 추가",
        `종목: **${stockName}**\n가격: **${money(price)}원**`
      );

      await answer(i, "✅ 주식 추가 완료");
      return updateAllMenus();
    }

    if (name === "주식삭제") {
      const stockName = i.options.getString("이름");

      if (!data.stocks[stockName])
        return answer(i, "❌ 존재하지 않는 주식입니다.");

      for (const a of Object.values(data.users)) {
        if (
          Number(a.stocks?.[stockName] || 0) > 0 ||
          Number(a.taxFreeStocks?.[stockName] || 0) > 0
        ) {
          return answer(i, "❌ 누군가 보유 중이라 삭제할 수 없습니다.");
        }
      }

      delete data.stocks[stockName];
      saveData();

      await log(
        i.guildId,
        "➖ 주식 삭제",
        `종목: **${stockName}**`
      );

      await answer(i, "✅ 주식 삭제 완료");
      return updateAllMenus();
    }

    if (name === "주식가격") {
      const stockName = i.options.getString("이름");
      const price = i.options.getInteger("가격");

      if (!data.stocks[stockName])
        return answer(i, "❌ 존재하지 않는 주식입니다.");

      const old = data.stocks[stockName].price;

      data.stocks[stockName].price = price;
      saveData();

      await log(
        i.guildId,
        "💹 주가 변경",
        `종목: **${stockName}**\n${money(old)}원 → ${money(price)}원`
      );

      await answer(i, "✅ 주가 변경 완료");
      return updateAllMenus();
    }

    if (
      ["돈추가", "돈제거", "면세돈추가", "면세돈제거"]
        .includes(name)
    ) {
      const user = i.options.getUser("사용자");
      const amount = BigInt(i.options.getString("금액"));
      const a = account(user.id);

      let key =
        name.startsWith("면세")
          ? "taxFreeMoney"
          : "money";

      if (name.endsWith("추가")) {
        a[key] =
          (BigInt(a[key]) + amount).toString();
      } else {
        a[key] =
          (BigInt(a[key]) > amount
            ? BigInt(a[key]) - amount
            : 0n
          ).toString();
      }

      saveData();

      await log(
        i.guildId,
        "💰 돈 변경",
        `관리자: ${i.user}\n대상: ${user}\n금액: **${money(amount)}원**`
      );

      return answer(i, "✅ 처리 완료");
    }

    if (name === "관리자메뉴") {
      const rows = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("admin_tax")
            .setLabel("세율 설정")
            .setStyle(ButtonStyle.Primary)
        ),
      ];

      return i.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("👑 관리자 메뉴")
            .setDescription(
              "세율 설정 및 관리자 기능을 이용하세요.\n\n" +
              "주식/돈/선거 관리는 슬래시 명령어로 사용할 수 있습니다."
            ),
        ],
        components: rows,
      }).then(() =>
        answer(i, "✅ 관리자 메뉴 생성 완료")
      );
    }
  } catch (e) {
    console.error("❌ Interaction 오류:", e);

    if (!i.replied && !i.deferred) {
      await i.reply({
        content: "❌ 처리 중 오류가 발생했습니다.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

/* 5분마다 주가 ±5% */
setInterval(async () => {
  let changed = false;

  for (const [name, stock] of Object.entries(data.stocks)) {
    const old = Number(stock.price);
    const percent = Math.floor(Math.random() * 11) - 5;

    const next = Math.max(
      1,
      Math.round(old * (100 + percent) / 100)
    );

    if (next !== old) {
      stock.price = next;
      changed = true;

      for (const guild of client.guilds.cache.values()) {
        await log(
          guild.id,
          "📈 자동 주가 변동",
          `종목: **${name}**\n${money(old)}원 → ${money(next)}원\n변동: **${percent}%**`
        );
      }
    }
  }

  if (changed) {
    saveData();
    await updateAllMenus();
  }
}, 5 * 60 * 1000);

/* Deploy Hatch 상태 확인용 */
const app = express();

app.get("/", (req, res) => {
  res.send("Discord bot is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ HTTP 서버 실행");
});

/* Discord 로그인 */
if (TOKEN && CLIENT_ID) {
  client.login(TOKEN)
    .then(() => {
      console.log("🔐 Discord 로그인 요청 성공");
    })
    .catch(err => {
      console.error("❌ Discord 로그인 실패:", err.message);
    });
}
