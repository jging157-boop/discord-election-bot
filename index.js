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
  ChannelType,
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATA_FILE = path.join(__dirname, "stock-data.json");

const SMALL_MIN = 2000;
const LARGE_MIN = 10000;
const SMALL_MAX = 20;
const LARGE_MAX = 50;
const MAX_SMALL_STOCKS = 20;
const DEFAULT_TAX_RATE = 20;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let data = {
  users: {},
  stocks: {
    WB그룹: { price: 1000, type: "small" },
    유마그룹: { price: 1000, type: "small" },
  },
  guilds: {},
};

const elections = new Map();

/* =========================
   데이터
========================= */

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );

      data.users = saved.users || {};
      data.stocks = saved.stocks || data.stocks;
      data.guilds = saved.guilds || {};
    }
  } catch (e) {
    console.error("데이터 불러오기 실패:", e);
  }

  for (const [name, stock] of Object.entries(data.stocks)) {
    if (typeof stock === "number") {
      data.stocks[name] = {
        price: stock,
        type: "small",
      };
    }

    data.stocks[name].price =
      Number(data.stocks[name].price) || 1;

    data.stocks[name].type =
      data.stocks[name].type === "large"
        ? "large"
        : "small";
  }

  saveData();
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );
  } catch (e) {
    console.error("저장 실패:", e);
  }
}

loadData();

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      taxRate: DEFAULT_TAX_RATE,
      logChannelId: null,
      stockMenuChannelId: null,
      stockMenuMessageId: null,
    };
  }

  return data.guilds[guildId];
}

function getAccount(userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      money: "0",
      taxFreeMoney: "0",
      stocks: {},
      taxFreeStocks: {},
    };
  }

  const a = data.users[userId];

  a.money = String(a.money ?? "0");
  a.taxFreeMoney = String(
    a.taxFreeMoney ?? "0"
  );
  a.stocks = a.stocks || {};
  a.taxFreeStocks = a.taxFreeStocks || {};

  return a;
}

function formatMoney(value) {
  return BigInt(value).toLocaleString("ko-KR");
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );
}

function getTax(guildId, amount) {
  const rate = BigInt(
    getGuild(guildId).taxRate
  );

  return (
    BigInt(amount) * rate
  ) / 100n;
}

/* =========================
   응답 / 로그
========================= */

async function replyDelete(
  interaction,
  content
) {
  try {
    if (
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({ content });
    } else {
      await interaction.editReply({ content });
    }

    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 10000);
  } catch {}
}

async function sendLog(
  guildId,
  title,
  description
) {
  try {
    const settings = getGuild(guildId);

    if (!settings.logChannelId) return;

    const guild =
      client.guilds.cache.get(guildId);

    if (!guild) return;

    const channel =
      guild.channels.cache.get(
        settings.logChannelId
      );

    if (!channel?.isTextBased()) return;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setTimestamp(),
      ],
    });
  } catch (e) {
    console.error("로그 오류:", e);
  }
}

/* =========================
   주식 거래소
========================= */

function stockText(guildId) {
  const settings = getGuild(guildId);

  let text =
    `🧾 세율: **${settings.taxRate}%**\n` +
    `🟢 소형 최소: **${formatMoney(
      SMALL_MIN
    )}원**\n` +
    `🔵 대형 최소: **${formatMoney(
      LARGE_MIN
    )}원**\n\n`;

  const stocks =
    Object.entries(data.stocks);

  if (stocks.length === 0) {
    return text + "현재 주식이 없습니다.";
  }

  for (const [name, stock] of stocks) {
    text +=
      `📈 **${name}**\n` +
      `가격: **${formatMoney(
        stock.price
      )}원**\n` +
      `종류: **${
        stock.type === "large"
          ? "대형"
          : "소형"
      }**\n\n`;
  }

  return text;
}

function stockButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stock_buy")
        .setLabel("일반돈 매수")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("stock_taxbuy")
        .setLabel("면세돈 매수")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("stock_sell")
        .setLabel("일반돈 매도")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("stock_taxsell")
        .setLabel("면세매도")
        .setStyle(ButtonStyle.Danger)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stock_wallet")
        .setLabel("내 지갑")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_mine")
        .setLabel("내 주식")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_list")
        .setLabel("주식 목록")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("stock_ranking")
        .setLabel("주식 랭킹")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function updateStockMenu(guildId) {
  try {
    const settings = getGuild(guildId);

    if (
      !settings.stockMenuChannelId ||
      !settings.stockMenuMessageId
    ) {
      return;
    }

    const guild =
      client.guilds.cache.get(guildId);

    if (!guild) return;

    const channel =
      guild.channels.cache.get(
        settings.stockMenuChannelId
      );

    if (!channel?.isTextBased()) return;

    const message =
      await channel.messages
        .fetch(
          settings.stockMenuMessageId
        )
        .catch(() => null);

    if (!message) return;

    await message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏦 주식 거래소")
          .setDescription(
            stockText(guildId)
          )
          .setTimestamp(),
      ],
      components: stockButtons(),
    });
  } catch {}
}

async function updateAllStockMenus() {
  for (const guild of client.guilds.cache.values()) {
    await updateStockMenu(guild.id);
  }
}

/* =========================
   후보 목록
========================= */

async function updateCandidateList(guildId) {
  const election =
    elections.get(guildId);

  if (!election) return;

  if (
    !election.candidateListChannelId ||
    !election.candidateListMessageId
  ) {
    return;
  }

  try {
    const guild =
      client.guilds.cache.get(guildId);

    if (!guild) return;

    const channel =
      guild.channels.cache.get(
        election.candidateListChannelId
      );

    if (!channel?.isTextBased()) return;

    const message =
      await channel.messages
        .fetch(
          election.candidateListMessageId
        )
        .catch(() => null);

    if (!message) return;

    const candidates =
      Object.keys(election.candidates);

    let text = "";

    if (candidates.length === 0) {
      text =
        "아직 등록된 후보가 없습니다.";
    } else {
      candidates.forEach((name, index) => {
        text +=
          `${index + 1}. **${name}**\n`;
      });
    }

    await message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗳️ 후보 목록")
          .setDescription(text)
          .setFooter({
            text:
              "관리자가 게시한 후보 목록",
          })
          .setTimestamp(),
      ],
    });
  } catch {}
}

/* =========================
   매수
========================= */

async function buyStock(
  interaction,
  stockName,
  quantity,
  taxFree
) {
  const stock = data.stocks[stockName];

  if (!stock) {
    return replyDelete(
      interaction,
      "❌ 존재하지 않는 주식입니다."
    );
  }

  quantity = Number(quantity);

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return replyDelete(
      interaction,
      "❌ 수량이 올바르지 않습니다."
    );
  }

  const max =
    stock.type === "large"
      ? LARGE_MAX
      : SMALL_MAX;

  if (quantity > max) {
    return replyDelete(
      interaction,
      `❌ 한 번에 최대 **${max}주**입니다.`
    );
  }

  const total =
    BigInt(stock.price) *
    BigInt(quantity);

  const minimum =
    stock.type === "large"
      ? LARGE_MIN
      : SMALL_MIN;

  if (total < BigInt(minimum)) {
    return replyDelete(
      interaction,
      `❌ 최소 구매금액은 **${formatMoney(
        minimum
      )}원**입니다.`
    );
  }

  const account =
    getAccount(interaction.user.id);

  const moneyKey = taxFree
    ? "taxFreeMoney"
    : "money";

  const stockKey = taxFree
    ? "taxFreeStocks"
    : "stocks";

  const taxAmount = taxFree
    ? 0n
    : getTax(
        interaction.guildId,
        total
      );

  const finalPrice =
    total + taxAmount;

  if (
    BigInt(account[moneyKey]) <
    finalPrice
  ) {
    return replyDelete(
      interaction,
      "❌ 돈이 부족합니다."
    );
  }

  account[moneyKey] =
    (
      BigInt(account[moneyKey]) -
      finalPrice
    ).toString();

  account[stockKey][stockName] =
    Number(
      account[stockKey][stockName] || 0
    ) + quantity;

  saveData();

  await sendLog(
    interaction.guildId,
    taxFree
      ? "🛡️ 면세돈 매수"
      : "📈 주식 매수",
    `사용자: ${interaction.user}\n` +
      `종목: **${stockName}**\n` +
      `수량: **${quantity}주**\n` +
      `금액: **${formatMoney(
        total
      )}원**\n` +
      `세금: **${formatMoney(
        taxAmount
      )}원**`
  );

  await replyDelete(
    interaction,
    `✅ **${stockName} ${quantity}주** 매수 완료\n` +
      `결제: **${formatMoney(
        finalPrice
      )}원**`
  );

  await updateAllStockMenus();
}

/* =========================
   매도
========================= */

async function sellStock(
  interaction,
  stockName,
  quantity,
  taxFree
) {
  const stock = data.stocks[stockName];

  if (!stock) {
    return replyDelete(
      interaction,
      "❌ 존재하지 않는 주식입니다."
    );
  }

  quantity = Number(quantity);

  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return replyDelete(
      interaction,
      "❌ 수량이 올바르지 않습니다."
    );
  }

  const account =
    getAccount(interaction.user.id);

  const stockKey = taxFree
    ? "taxFreeStocks"
    : "stocks";

  const moneyKey = taxFree
    ? "taxFreeMoney"
    : "money";

  const owned = Number(
    account[stockKey][stockName] || 0
  );

  if (owned < quantity) {
    return replyDelete(
      interaction,
      `❌ 보유 주식이 부족합니다.`
    );
  }

  const gross =
    BigInt(stock.price) *
    BigInt(quantity);

  const taxAmount = taxFree
    ? 0n
    : getTax(
        interaction.guildId,
        gross
      );

  const received =
    gross - taxAmount;

  account[stockKey][stockName] =
    owned - quantity;

  if (
    account[stockKey][stockName] <= 0
  ) {
    delete account[stockKey][stockName];
  }

  account[moneyKey] =
    (
      BigInt(account[moneyKey]) +
      received
    ).toString();

  saveData();

  await sendLog(
    interaction.guildId,
    taxFree
      ? "🛡️ 면세매도"
      : "📉 주식 매도",
    `사용자: ${interaction.user}\n` +
      `종목: **${stockName}**\n` +
      `수량: **${quantity}주**\n` +
      `금액: **${formatMoney(
        gross
      )}원**\n` +
      `세금: **${formatMoney(
        taxAmount
      )}원**`
  );

  await replyDelete(
    interaction,
    `✅ **${stockName} ${quantity}주** 매도 완료\n` +
      `받은 금액: **${formatMoney(
        received
      )}원**`
  );

  await updateAllStockMenus();
}

/* =========================
   명령어
========================= */

const commands = [
  new SlashCommandBuilder()
    .setName("선거시작")
    .setDescription("선거 시작"),

  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("후보 등록")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("후보 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("후보목록")
    .setDescription("후보 목록 게시"),

  new SlashCommandBuilder()
    .setName("투표")
    .setDescription("투표")
    .addStringOption(o =>
      o.setName("후보")
        .setDescription("후보 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("선거종료")
    .setDescription("선거 종료"),

  new SlashCommandBuilder()
    .setName("결과")
    .setDescription("선거 결과"),

  new SlashCommandBuilder()
    .setName("주식참여")
    .setDescription("주식 참여"),

  new SlashCommandBuilder()
    .setName("주식목록")
    .setDescription("주식 목록"),

  new SlashCommandBuilder()
    .setName("주식메뉴")
    .setDescription("주식 메뉴"),

  new SlashCommandBuilder()
    .setName("잔액")
    .setDescription("잔액 확인"),

  new SlashCommandBuilder()
    .setName("내주식")
    .setDescription("내 주식"),

  new SlashCommandBuilder()
    .setName("주식랭킹")
    .setDescription("주식 랭킹"),

  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("주식 매수")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식")
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
    .setDescription("면세돈 매수")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식")
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
    .setDescription("주식 매도")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식")
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
    .setDescription("면세매도")
    .addStringOption(o =>
      o.setName("종목")
        .setDescription("주식")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("수량")
        .setDescription("수량")
        .setMinValue(1)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("돈추가")
    .setDescription("돈 추가")
    .addUserOption(o =>
      o.setName("사용자")
        .setDescription("사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("돈제거")
    .setDescription("돈 제거")
    .addUserOption(o =>
      o.setName("사용자")
        .setDescription("사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세돈추가")
    .setDescription("면세돈 추가")
    .addUserOption(o =>
      o.setName("사용자")
        .setDescription("사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("면세돈제거")
    .setDescription("면세돈 제거")
    .addUserOption(o =>
      o.setName("사용자")
        .setDescription("사용자")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("금액")
        .setDescription("금액")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식추가")
    .setDescription("주식 추가")
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
    .addStringOption(o =>
      o.setName("종류")
        .setDescription("종류")
        .setRequired(true)
        .addChoices(
          {
            name: "소형",
            value: "small",
          },
          {
            name: "대형",
            value: "large",
          }
        )
    ),

  new SlashCommandBuilder()
    .setName("주식삭제")
    .setDescription("주식 삭제")
    .addStringOption(o =>
      o.setName("이름")
        .setDescription("주식 이름")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("주식가격")
    .setDescription("주가 변경")
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
    .setName("세금률설정")
    .setDescription("세율 설정")
    .addIntegerOption(o =>
      o.setName("세율")
        .setDescription("0~100")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("로그채널")
    .setDescription("로그 채널 설정")
    .addChannelOption(o =>
      o.setName("채널")
        .setDescription("로그 채널")
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("관리자메뉴")
    .setDescription("관리자 메뉴"),
].map(x => x.toJSON());

/* =========================
   명령어 등록
========================= */

client.once("ready", async () => {
  console.log(
    `✅ 로그인: ${client.user.tag}`
  );

  const rest = new REST({
    version: "10",
  }).setToken(TOKEN);

  try {
    // 글로벌 중복 명령어 삭제
    await rest.put(
      Routes.applicationCommands(
        CLIENT_ID
      ),
      {
        body: [],
      }
    );

    console.log(
      "🧹 글로벌 중복 명령어 삭제 완료"
    );
  } catch (e) {
    console.error(
      "글로벌 삭제 실패:",
      e.message
    );
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(
          CLIENT_ID,
          guild.id
        ),
        {
          body: commands,
        }
      );

      console.log(
        `✅ 명령어 등록: ${guild.name}`
      );
    } catch (e) {
      console.error(
        "명령어 등록 실패:",
        e.message
      );
    }
  }
});

client.on("guildCreate", async guild => {
  try {
    const rest = new REST({
      version: "10",
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        guild.id
      ),
      {
        body: commands,
      }
    );
  } catch {}
});

/* =========================
   인터랙션
========================= */

client.on(
  "interactionCreate",
  async interaction => {
    try {
      /* ---------- 버튼 ---------- */

      if (interaction.isButton()) {
        const id =
          interaction.customId;

        if (
          [
            "stock_buy",
            "stock_taxbuy",
            "stock_sell",
            "stock_taxsell",
          ].includes(id)
        ) {
          const titles = {
            stock_buy:
              "일반돈으로 매수",
            stock_taxbuy:
              "면세돈으로 매수",
            stock_sell:
              "일반돈으로 매도",
            stock_taxsell:
              "면세돈으로 매도",
          };

          const modal =
            new ModalBuilder()
              .setCustomId(
                `trade_${id}`
              )
              .setTitle(titles[id]);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("stock")
                .setLabel("주식 이름")
                .setPlaceholder(
                  "예: WB그룹"
                )
                .setStyle(
                  TextInputStyle.Short
                )
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(
                  "quantity"
                )
                .setLabel("수량")
                .setPlaceholder(
                  "예: 5"
                )
                .setStyle(
                  TextInputStyle.Short
                )
                .setRequired(true)
            )
          );

          return interaction.showModal(
            modal
          );
        }

        if (id === "stock_wallet") {
          const a = getAccount(
            interaction.user.id
          );

          return interaction.reply({
            content:
              `💰 일반돈: **${formatMoney(
                a.money
              )}원**\n` +
              `🛡️ 면세돈: **${formatMoney(
                a.taxFreeMoney
              )}원**`,
            ephemeral: true,
          });
        }

        if (id === "stock_mine") {
          const a = getAccount(
            interaction.user.id
          );

          let text =
            "📊 **내 주식**\n\n";

          for (const [
            name,
            qty,
          ] of Object.entries(
            a.stocks
          )) {
            text +=
              `📈 ${name}: **${qty}주**\n`;
          }

          for (const [
            name,
            qty,
          ] of Object.entries(
            a.taxFreeStocks
          )) {
            text +=
              `🛡️ ${name}: **${qty}주**\n`;
          }

          if (
            text ===
            "📊 **내 주식**\n\n"
          ) {
            text +=
              "보유 주식이 없습니다.";
          }

          return interaction.reply({
            content: text,
            ephemeral: true,
          });
        }

        if (id === "stock_list") {
          return interaction.reply({
            content: stockText(
              interaction.guildId
            ),
            ephemeral: true,
          });
        }

        if (id === "stock_ranking") {
          const ranking = [];

          for (const [
            userId,
            a,
          ] of Object.entries(
            data.users
          )) {
            let total =
              BigInt(
                a.money || 0
              ) +
              BigInt(
                a.taxFreeMoney || 0
              );

            for (const [
              name,
              qty,
            ] of Object.entries(
              a.stocks || {}
            )) {
              if (
                data.stocks[name]
              ) {
                total +=
                  BigInt(
                    data.stocks[
                      name
                    ].price
                  ) *
                  BigInt(qty);
              }
            }

            ranking.push({
              userId,
              total,
            });
          }

          ranking.sort(
            (a, b) =>
              a.total > b.total
                ? -1
                : 1
          );

          let text =
            "🏆 **주식 랭킹**\n\n";

          ranking
            .slice(0, 10)
            .forEach(
              (item, index) => {
                text +=
                  `${index + 1}. <@${item.userId}> — **${formatMoney(
                    item.total
                  )}원**\n`;
              }
            );

          if (
            ranking.length === 0
          ) {
            text +=
              "아직 참가자가 없습니다.";
          }

          return interaction.reply({
            content: text,
            ephemeral: true,
          });
        }

        return;
      }

      /* ---------- 모달 ---------- */

      if (
        interaction.isModalSubmit()
      ) {
        const id =
          interaction.customId;

        if (
          id.startsWith("trade_")
        ) {
          const type =
            id.replace(
              "trade_",
              ""
            );

          const stock =
            interaction.fields.getTextInputValue(
              "stock"
            );

          const quantity =
            interaction.fields.getTextInputValue(
              "quantity"
            );

          if (
            type === "stock_buy"
          ) {
            return buyStock(
              interaction,
              stock,
              quantity,
              false
            );
          }

          if (
            type ===
            "stock_taxbuy"
          ) {
            return buyStock(
              interaction,
              stock,
              quantity,
              true
            );
          }

          if (
            type === "stock_sell"
          ) {
            return sellStock(
              interaction,
              stock,
              quantity,
              false
            );
          }

          if (
            type ===
            "stock_taxsell"
          ) {
            return sellStock(
              interaction,
              stock,
              quantity,
              true
            );
          }
        }

        return;
      }

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      const command =
        interaction.commandName;

      const adminOnly = [
        "선거시작",
        "후보등록",
        "후보목록",
        "선거종료",
        "결과",
        "주식메뉴",
        "돈추가",
        "돈제거",
        "면세돈추가",
        "면세돈제거",
        "주식추가",
        "주식삭제",
        "주식가격",
        "세금률설정",
        "로그채널",
        "관리자메뉴",
      ];

      if (
        adminOnly.includes(
          command
        ) &&
        !isAdmin(interaction)
      ) {
        return replyDelete(
          interaction,
          "❌ 서버 관리자만 사용할 수 있습니다."
        );
      }

      /* ---------- 주식 메뉴 ---------- */

      if (
        command === "주식메뉴"
      ) {
        const message =
          await interaction.channel.send(
            {
              embeds: [
                new EmbedBuilder()
                  .setTitle(
                    "🏦 주식 거래소"
                  )
                  .setDescription(
                    stockText(
                      interaction.guildId
                    )
                  )
                  .setTimestamp(),
              ],
              components:
                stockButtons(),
            }
          );

        const settings =
          getGuild(
            interaction.guildId
          );

        settings.stockMenuChannelId =
          interaction.channelId;

        settings.stockMenuMessageId =
          message.id;

        saveData();

        return replyDelete(
          interaction,
          "✅ 주식 거래소 메뉴를 만들었습니다."
        );
      }

      /* ---------- 주식 ---------- */

      if (
        command === "주식참여"
      ) {
        getAccount(
          interaction.user.id
        );

        saveData();

        return interaction.reply({
          content:
            "✅ 주식 참여 완료!",
          ephemeral: true,
        });
      }

      if (
        command === "주식목록"
      ) {
        return interaction.reply({
          content: stockText(
            interaction.guildId
          ),
          ephemeral: true,
        });
      }

      if (command === "잔액") {
        const a =
          getAccount(
            interaction.user.id
          );

        return interaction.reply({
          content:
            `💰 일반돈: **${formatMoney(
              a.money
            )}원**\n` +
            `🛡️ 면세돈: **${formatMoney(
              a.taxFreeMoney
            )}원**`,
          ephemeral: true,
        });
      }

      if (
        command === "내주식"
      ) {
        const a =
          getAccount(
            interaction.user.id
          );

        let text =
          "📊 **내 주식**\n\n";

        for (const [
          name,
          qty,
        ] of Object.entries(
          a.stocks
        )) {
          text +=
            `📈 ${name}: **${qty}주**\n`;
        }

        for (const [
          name,
          qty,
        ] of Object.entries(
          a.taxFreeStocks
        )) {
          text +=
            `🛡️ ${name}: **${qty}주**\n`;
        }

        if (
          text ===
          "📊 **내 주식**\n\n"
        ) {
          text +=
            "보유 주식이 없습니다.";
        }

        return interaction.reply({
          content: text,
          ephemeral: true,
        });
      }

      if (
        command === "주식랭킹"
      ) {
        return interaction.reply({
          content:
            "🏆 거래소의 주식 랭킹 버튼을 이용하세요.",
          ephemeral: true,
        });
      }

      if (command === "매수") {
        return buyStock(
          interaction,
          interaction.options.getString(
            "종목"
          ),
          interaction.options.getInteger(
            "수량"
          ),
          false
        );
      }

      if (
        command === "면세매수"
      ) {
        return buyStock(
          interaction,
          interaction.options.getString(
            "종목"
          ),
          interaction.options.getInteger(
            "수량"
          ),
          true
        );
      }

      if (command === "매도") {
        return sellStock(
          interaction,
          interaction.options.getString(
            "종목"
          ),
          interaction.options.getInteger(
            "수량"
          ),
          false
        );
      }

      if (
        command === "면세매도"
      ) {
        return sellStock(
          interaction,
          interaction.options.getString(
            "종목"
          ),
          interaction.options.getInteger(
            "수량"
          ),
          true
        );
      }

      /* =========================
         선거 시작
      ========================= */

      if (
        command === "선거시작"
      ) {
        elections.set(
          interaction.guildId,
          {
            active: true,
            candidates: {},
            voters: {},
            candidateListChannelId:
              null,
            candidateListMessageId:
              null,
          }
        );

        await sendLog(
          interaction.guildId,
          "🗳️ 선거 시작",
          `관리자: ${interaction.user}`
        );

        return replyDelete(
          interaction,
          "✅ 선거가 시작되었습니다.\n관리자는 /후보등록 후 /후보목록을 사용하세요."
        );
      }

      /* =========================
         후보 등록
      ========================= */

      if (
        command === "후보등록"
      ) {
        const election =
          elections.get(
            interaction.guildId
          );

        if (
          !election?.active
        ) {
          return replyDelete(
            interaction,
            "❌ 진행 중인 선거가 없습니다."
          );
        }

        const name =
          interaction.options.getString(
            "이름"
          );

        if (
          Object.keys(
            election.candidates
          ).length >= 20
        ) {
          return replyDelete(
            interaction,
            "❌ 후보는 최대 20명입니다."
          );
        }

        if (
          election.candidates[
            name
          ] !== undefined
        ) {
          return replyDelete(
            interaction,
            "❌ 이미 등록된 후보입니다."
          );
        }

        election.candidates[
          name
        ] = 0;

        await updateCandidateList(
          interaction.guildId
        );

        await sendLog(
          interaction.guildId,
          "📝 후보 등록",
          `후보: **${name}**\n관리자: ${interaction.user}`
        );

        return replyDelete(
          interaction,
          `✅ **${name}** 후보 등록 완료`
        );
      }

      /* =========================
         후보 목록 게시
      ========================= */

      if (
        command === "후보목록"
      ) {
        const election =
          elections.get(
            interaction.guildId
          );

        if (!election) {
          return replyDelete(
            interaction,
            "❌ 먼저 /선거시작 을 해주세요."
          );
        }

        const candidates =
          Object.keys(
            election.candidates
          );

        let text = "";

        if (
          candidates.length === 0
        ) {
          text =
            "아직 등록된 후보가 없습니다.";
        } else {
          candidates.forEach(
            (name, index) => {
              text +=
                `${index + 1}. **${name}**\n`;
            }
          );
        }

        const message =
          await interaction.channel.send(
            {
              embeds: [
                new EmbedBuilder()
                  .setTitle(
                    "🗳️ 후보 목록"
                  )
                  .setDescription(text)
                  .setFooter({
                    text:
                      "관리자가 게시한 후보 목록",
                  })
                  .setTimestamp(),
              ],
            }
          );

        election.candidateListChannelId =
          interaction.channelId;

        election.candidateListMessageId =
          message.id;

        return replyDelete(
          interaction,
          "✅ 후보 목록을 게시했습니다."
        );
      }

      /* =========================
         투표
      ========================= */

      if (
        command === "투표"
      ) {
        const election =
          elections.get(
            interaction.guildId
          );

        if (
          !election?.active
        ) {
          return replyDelete(
            interaction,
            "❌ 진행 중인 선거가 없습니다."
          );
        }

        const candidate =
          interaction.options.getString(
            "후보"
          );

        if (
          election.candidates[
            candidate
          ] === undefined
        ) {
          return replyDelete(
            interaction,
            "❌ 존재하지 않는 후보입니다."
          );
        }

        if (
          election.voters[
            interaction.user.id
          ]
        ) {
          return replyDelete(
            interaction,
            "❌ 이미 투표했습니다."
          );
        }

        election.voters[
          interaction.user.id
        ] = candidate;

        election.candidates[
          candidate
        ]++;

        await sendLog(
          interaction.guildId,
          "🗳️ 투표",
          `사용자: ${interaction.user}\n후보: **${candidate}**`
        );

        return replyDelete(
          interaction,
          `✅ **${candidate}** 후보에게 투표했습니다.`
        );
      }

      /* =========================
         선거 종료
      ========================= */

      if (
        command === "선거종료"
      ) {
        const election =
          elections.get(
            interaction.guildId
          );

        if (
          !election?.active
        ) {
          return replyDelete(
            interaction,
            "❌ 진행 중인 선거가 없습니다."
          );
        }

        election.active = false;

        await sendLog(
          interaction.guildId,
          "🛑 선거 종료",
          `관리자: ${interaction.user}`
        );

        return replyDelete(
          interaction,
          "✅ 선거가 종료되었습니다."
        );
      }

      /* =========================
         결과
      ========================= */

      if (command === "결과") {
        const election =
          elections.get(
            interaction.guildId
          );

        if (!election) {
          return replyDelete(
            interaction,
            "❌ 선거가 없습니다."
          );
        }

        const result =
          Object.entries(
            election.candidates
          )
            .sort(
              (a, b) =>
                b[1] - a[1]
            )
            .map(
              ([name, votes], index) =>
                `${index + 1}. **${name}** — ${votes}표`
            )
            .join("\n");

        return interaction.reply({
          content:
            `📊 **선거 결과**\n\n` +
            (result ||
              "후보가 없습니다."),
          ephemeral: true,
        });
      }

      /* =========================
         돈
      ========================= */

      if (
        [
          "돈추가",
          "돈제거",
          "면세돈추가",
          "면세돈제거",
        ].includes(command)
      ) {
        const user =
          interaction.options.getUser(
            "사용자"
          );

        let raw =
          interaction.options.getString(
            "금액"
          );

        raw = raw.replace(
          /,/g,
          ""
        );

        let amount;

        try {
          amount = BigInt(raw);
        } catch {
          return replyDelete(
            interaction,
            "❌ 금액이 올바르지 않습니다."
          );
        }

        if (amount <= 0n) {
          return replyDelete(
            interaction,
            "❌ 금액은 1원 이상이어야 합니다."
          );
        }

        const a =
          getAccount(user.id);

        const key =
          command.startsWith("면세")
            ? "taxFreeMoney"
            : "money";

        const add =
          command.endsWith("추가");

        const old =
          BigInt(a[key]);

        if (add) {
          a[key] =
            (
              old + amount
            ).toString();
        } else {
          a[key] =
            old > amount
              ? (
                  old - amount
                ).toString()
              : "0";
        }

        saveData();

        await sendLog(
          interaction.guildId,
          add
            ? "💰 돈 추가"
            : "💸 돈 제거",
          `관리자: ${interaction.user}\n` +
            `대상: ${user}\n` +
            `종류: ${
              key ===
              "taxFreeMoney"
                ? "면세돈"
                : "일반돈"
            }\n` +
            `금액: **${formatMoney(
              amount
            )}원**`
        );

        return replyDelete(
          interaction,
          `✅ ${
            add ? "추가" : "제거"
          } 완료`
        );
      }

      /* =========================
         주식 추가
      ========================= */

      if (
        command === "주식추가"
      ) {
        const name =
          interaction.options.getString(
            "이름"
          );

        const price =
          interaction.options.getInteger(
            "가격"
          );

        const type =
          interaction.options.getString(
            "종류"
          );

        if (data.stocks[name]) {
          return replyDelete(
            interaction,
            "❌ 이미 존재하는 주식입니다."
          );
        }

        const smallCount =
          Object.values(
            data.stocks
          ).filter(
            s =>
              s.type === "small"
          ).length;

        if (
          type === "small" &&
          smallCount >=
            MAX_SMALL_STOCKS
        ) {
          return replyDelete(
            interaction,
            "❌ 소형 주식은 최대 20종목입니다."
          );
        }

        data.stocks[name] = {
          price,
          type,
        };

        saveData();

        await sendLog(
          interaction.guildId,
          "➕ 주식 추가",
          `종목: **${name}**\n` +
            `가격: **${formatMoney(
              price
            )}원**`
        );

        await replyDelete(
          interaction,
          "✅ 주식 추가 완료"
        );

        await updateAllStockMenus();

        return;
      }

      /* =========================
         주식 삭제
      ========================= */

      if (
        command === "주식삭제"
      ) {
        const name =
          interaction.options.getString(
            "이름"
          );

        if (!data.stocks[name]) {
          return replyDelete(
            interaction,
            "❌ 존재하지 않는 주식입니다."
          );
        }

        for (const a of Object.values(
          data.users
        )) {
          if (
            Number(
              a.stocks?.[name] ||
                0
            ) > 0 ||
            Number(
              a.taxFreeStocks?.[
                name
              ] || 0
            ) > 0
          ) {
            return replyDelete(
              interaction,
              "❌ 누군가 보유 중인 주식이라 삭제할 수 없습니다."
            );
          }
        }

        delete data.stocks[name];

        saveData();

        await sendLog(
          interaction.guildId,
          "➖ 주식 삭제",
          `종목: **${name}**`
        );

        await replyDelete(
          interaction,
          "✅ 주식 삭제 완료"
        );

        await updateAllStockMenus();

        return;
      }

      /* =========================
         주가 변경
      ========================= */

      if (
        command === "주식가격"
      ) {
        const name =
          interaction.options.getString(
            "이름"
          );

        const price =
          interaction.options.getInteger(
            "가격"
          );

        if (!data.stocks[name]) {
          return replyDelete(
            interaction,
            "❌ 존재하지 않는 주식입니다."
          );
        }

        const old =
          data.stocks[name].price;

        data.stocks[name].price =
          price;

        saveData();

        await sendLog(
          interaction.guildId,
          "💹 주가 변경",
          `종목: **${name}**\n` +
            `기존: **${formatMoney(
              old
            )}원**\n` +
            `변경: **${formatMoney(
              price
            )}원**`
        );

        await replyDelete(
          interaction,
          "✅ 주가 변경 완료"
        );

        await updateAllStockMenus();

        return;
      }

      /* =========================
         세율
      ========================= */

      if (
        command === "세금률설정"
      ) {
        const rate =
          interaction.options.getInteger(
            "세율"
          );

        const settings =
          getGuild(
            interaction.guildId
          );

        const old =
          settings.taxRate;

        settings.taxRate = rate;

        saveData();

        await sendLog(
          interaction.guildId,
          "🧾 세율 변경",
          `기존: **${old}%**\n변경: **${rate}%**`
        );

        await replyDelete(
          interaction,
          `✅ 세율이 **${rate}%**로 변경되었습니다.`
        );

        await updateAllStockMenus();

        return;
      }

      /* =========================
         로그 채널
      ========================= */

      if (
        command === "로그채널"
      ) {
        const channel =
          interaction.options.getChannel(
            "채널"
          );

        if (
          !channel ||
          channel.type !==
            ChannelType.GuildText
        ) {
          return replyDelete(
            interaction,
            "❌ 텍스트 채널을 선택해주세요."
          );
        }

        getGuild(
          interaction.guildId
        ).logChannelId =
          channel.id;

        saveData();

        return replyDelete(
          interaction,
          `✅ 로그 채널을 ${channel}로 설정했습니다.`
        );
      }

      /* =========================
         관리자 메뉴
      ========================= */

      if (
        command === "관리자메뉴"
      ) {
        return interaction.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "👑 관리자 메뉴"
                )
                .setDescription(
                  "관리자 전용 명령어\n\n" +
                  "`/주식추가`\n" +
                  "`/주식삭제`\n" +
                  "`/주식가격`\n" +
                  "`/돈추가`\n" +
                  "`/돈제거`\n" +
                  "`/면세돈추가`\n" +
                  "`/면세돈제거`\n" +
                  "`/세금률설정`\n" +
                  "`/로그채널`\n" +
                  "`/선거시작`\n" +
                  "`/후보등록`\n" +
                  "`/후보목록`\n" +
                  "`/선거종료`\n" +
                  "`/결과`"
                )
                .setTimestamp(),
            ],
          })
          .then(() =>
            replyDelete(
              interaction,
              "✅ 관리자 메뉴 생성 완료"
            )
          );
      }
    } catch (e) {
      console.error(
        "Interaction 오류:",
        e
      );

      try {
        if (
          !interaction.replied
        ) {
          await interaction.reply({
            content:
              "❌ 처리 중 오류가 발생했습니다.",
            ephemeral: true,
          });
        }
      } catch {}
    }
  }
);

/* =========================
   5분마다 주가 ±5%
========================= */

setInterval(
  async () => {
    const changes = [];

    for (const [
      name,
      stock,
    ] of Object.entries(
      data.stocks
    )) {
      const old =
        Number(stock.price);

      const percent =
        Math.floor(
          Math.random() * 11
        ) - 5;

      const next =
        Math.max(
          1,
          Math.round(
            old *
              (100 + percent) /
              100
          )
        );

      stock.price = next;

      if (old !== next) {
        changes.push(
          `${name}: ${formatMoney(
            old
          )}원 → ${formatMoney(
            next
          )}원`
        );
      }
    }

    if (changes.length) {
      saveData();

      await updateAllStockMenus();

      for (const guild of client.guilds.cache.values()) {
        await sendLog(
          guild.id,
          "📈 자동 주가 변동",
          changes.join("\n")
        );
      }
    }
  },
  5 * 60 * 1000
);

/* =========================
   서버
========================= */

const app = express();

app.get("/", (req, res) => {
  res.send(
    "Discord Election & Stock Bot is running."
  );
});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `🌐 HTTP 서버 실행: ${PORT}`
  );
});

/* =========================
   로그인
========================= */

client
  .login(TOKEN)
  .then(() => {
    console.log("🔐 Discord 로그인 성공");
  })
  .catch(err => {
    console.error(
      "❌ Discord 로그인 실패:",
      err.message
    );
  });
