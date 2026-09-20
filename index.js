const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.log("DISCORD_TOKEN 또는 CLIENT_ID가 없습니다.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const elections = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("선거시작")
    .setDescription("새로운 선거를 시작합니다."),
  new SlashCommandBuilder()
    .setName("후보등록")
    .setDescription("후보를 등록합니다.")
    .addStringOption(o =>
      o.setName("이름").setDescription("후보 이름").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("투표")
    .setDescription("후보에게 투표합니다.")
    .addStringOption(o =>
      o.setName("후보").setDescription("후보 이름").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("선거종료")
    .setDescription("현재 선거를 종료합니다."),
  new SlashCommandBuilder()
    .setName("결과")
    .setDescription("현재 선거 결과를 확인합니다.")
].map(c => c.toJSON());

client.once("ready", async () => {
  console.log(`${client.user.tag} 로그인 완료!`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("슬래시 명령어 등록 완료!");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  let election = elections.get(guildId);

  // 선거 시작
  if (interaction.commandName === "선거시작") {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply("❌ 서버 관리자만 선거를 시작할 수 있습니다.");
    }

    if (election?.active) {
      return interaction.reply("❌ 이미 진행 중인 선거가 있습니다.");
    }

    election = {
      active: true,
      candidates: new Map(),
      voters: new Set(),
      startedBy: interaction.user.id
    };

    elections.set(guildId, election);

    return interaction.reply(
      "🗳️ **선거가 시작되었습니다!**\n`/후보등록`으로 후보를 등록하세요."
    );
  }

  if (!election?.active) {
    return interaction.reply("❌ 현재 진행 중인 선거가 없습니다.");
  }

  // 후보 등록
  if (interaction.commandName === "후보등록") {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply("❌ 서버 관리자만 후보를 등록할 수 있습니다.");
    }

    const name = interaction.options.getString("이름").trim();

    if (election.candidates.has(name)) {
      return interaction.reply("❌ 이미 등록된 후보입니다.");
    }

    if (election.candidates.size >= 20) {
      return interaction.reply("❌ 후보는 최대 20명까지 등록할 수 있습니다.");
    }

    election.candidates.set(name, 0);

    return interaction.reply(`✅ **${name}** 후보가 등록되었습니다.`);
  }

  // 투표
  if (interaction.commandName === "투표") {
    if (election.voters.has(interaction.user.id)) {
      return interaction.reply("❌ 이미 투표했습니다.");
    }

    const name = interaction.options.getString("후보").trim();

    if (!election.candidates.has(name)) {
      return interaction.reply("❌ 존재하지 않는 후보입니다.");
    }

    election.candidates.set(
      name,
      election.candidates.get(name) + 1
    );

    election.voters.add(interaction.user.id);

    return interaction.reply(`✅ **${name}** 후보에게 투표했습니다.`);
  }

  // 선거 종료
  if (interaction.commandName === "선거종료") {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply("❌ 서버 관리자만 선거를 종료할 수 있습니다.");
    }

    election.active = false;

    return interaction.reply("🛑 **선거가 종료되었습니다.**\n`/결과`로 결과를 확인하세요.");
  }

  // 결과
  if (interaction.commandName === "결과") {
    const result = [...election.candidates.entries()]
      .sort((a, b) => b[1] - a[1]);

    if (result.length === 0) {
      return interaction.reply("등록된 후보가 없습니다.");
    }

    let text = "📊 **선거 결과**\n\n";

    result.forEach(([name, votes], i) => {
      text += `${i + 1}. **${name}** — ${votes}표\n`;
    });

    text += `\n총 투표자: ${election.voters.size}명`;

    return interaction.reply(text);
  }
});

const app = express();

app.get("/", (req, res) => {
  res.send("Discord Election Bot is running!");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("웹 서버 실행!");
});

client.login(TOKEN);
