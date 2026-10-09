const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ==========================================
// 1. 기본 설정
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    throw new Error(
        'DISCORD_TOKEN과 CLIENT_ID 환경변수를 설정하세요.'
    );
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'economy.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(
            fs.readFileSync(DATA_FILE, 'utf8')
        );
    } catch (error) {
        console.error('데이터 파일 오류:', error);
        process.exit(1);
    }
}

function saveDB() {
    const temp = DATA_FILE + '.tmp';

    fs.writeFileSync(
        temp,
        JSON.stringify(db, null, 2),
        'utf8'
    );

    fs.renameSync(temp, DATA_FILE);
}

// ==========================================
// 2. 서버별 데이터
// ==========================================

function getGuild(guildId) {
    if (!db[guildId]) {
        db[guildId] = {
            users: {},
            companies: {},
            elections: {},
            exchangeRequests: {},
            nextExchangeId: 1,

            taxRate: 20,

            inflation: {
                enabled: false,
                rate: 0
            },

            exchangeRate: 1,

            settings: {
                logChannelId: null
            }
        };

        saveDB();
    }

    return db[guildId];
}

function getUser(guild, userId) {
    if (!guild.users[userId]) {
        guild.users[userId] = {
            money: 0,
            taxFreeMoney: 0,
            bank: 0,
            savings: [],
            loans: [],
            shares: {},
            stocks: {}
        };
    }

    const user = guild.users[userId];

    user.savings ??= [];
    user.loans ??= [];
    user.shares ??= {};
    user.stocks ??= {};
    user.taxFreeMoney ??= 0;

    return user;
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    ) ?? false;
}

function isChairman(company, userId) {
    return company.chairmanId === userId;
}

function money(value) {
    return Math.floor(value).toLocaleString('ko-KR') + '원';
}

function safeAmount(value) {
    return Number.isSafeInteger(value) &&
        value > 0 &&
        value <= 1_000_000_000_000;
}

async function logEvent(interaction, message) {
    const guild = getGuild(interaction.guildId);
    const channelId = guild.settings.logChannelId;

    if (!channelId) return;

    const channel = await interaction.guild.channels
        .fetch(channelId)
        .catch(() => null);

    if (channel?.isTextBased()) {
        await channel.send(message).catch(console.error);
    }
}

// ==========================================
// 3. 슬래시 명령어
// ==========================================

const commands = [

    new SlashCommandBuilder()
        .setName('잔액')
        .setDescription('보유 자산 확인'),

    new SlashCommandBuilder()
        .setName('돈추가')
        .setDescription('관리자 전용 돈 추가')
        .addUserOption(o =>
            o.setName('대상')
                .setDescription('대상 사용자')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('추가 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('돈제거')
        .setDescription('관리자 전용 돈 제거')
        .addUserOption(o =>
            o.setName('대상')
                .setDescription('대상 사용자')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('제거 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('은행메뉴')
        .setDescription('은행 메뉴 표시'),

    new SlashCommandBuilder()
        .setName('입금')
        .setDescription('은행 입금')
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('입금 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('출금')
        .setDescription('은행 출금')
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('출금 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('적금가입')
        .setDescription('적금 가입')
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('가입 금액')
                .setMinValue(1)
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('기간')
                .setDescription('기간')
                .addChoices(
                    { name: '1개월', value: 1 },
                    { name: '3개월', value: 3 }
                )
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('적금조회')
        .setDescription('적금 조회'),

    new SlashCommandBuilder()
        .setName('대출신청')
        .setDescription('대출 신청')
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('대출 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('대출상환')
        .setDescription('대출 상환')
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('상환 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('기업추가')
        .setDescription('기업 추가')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addUserOption(o =>
            o.setName('회장')
                .setDescription('회장')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('기업삭제')
        .setDescription('기업 삭제')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('회장지정')
        .setDescription('회장 지정')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addUserOption(o =>
            o.setName('대상')
                .setDescription('새 회장')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('지분발행')
        .setDescription('기업 지분 발행')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량')
                .setDescription('발행 수량')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('지분양도')
        .setDescription('지분 양도')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addUserOption(o =>
            o.setName('대상')
                .setDescription('받을 사용자')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량')
                .setDescription('양도 수량')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('지분회수')
        .setDescription('기업 지분 회수')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addUserOption(o =>
            o.setName('대상')
                .setDescription('회수 대상')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량')
                .setDescription('회수 수량')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('세금설정')
        .setDescription('세율 설정')
        .addNumberOption(o =>
            o.setName('세율')
                .setDescription('세율 퍼센트')
                .setMinValue(0)
                .setMaxValue(100)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('주가조정')
        .setDescription('주가 조정')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('가격')
                .setDescription('새 주가')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('주식매수')
        .setDescription('주식 매수')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량')
                .setDescription('매수 수량')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('주식매도')
        .setDescription('주식 매도')
        .addStringOption(o =>
            o.setName('기업명')
                .setDescription('기업명')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량')
                .setDescription('매도 수량')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('인플레이션설정')
        .setDescription('인플레이션 설정')
        .addBooleanOption(o =>
            o.setName('활성화')
                .setDescription('활성화 여부')
                .setRequired(true))
        .addNumberOption(o =>
            o.setName('변동률')
                .setDescription('변동률 퍼센트')
                .setMinValue(-100)
                .setMaxValue(1000)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('환전신청')
        .setDescription('환전 신청')
        .addIntegerOption(o =>
            o.setName('금액')
                .setDescription('환전할 금액')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('환전승인')
        .setDescription('관리자 전용 환전 승인')
        .addIntegerOption(o =>
            o.setName('번호')
                .setDescription('신청 번호')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('환전거절')
        .setDescription('관리자 전용 환전 거절')
        .addIntegerOption(o =>
            o.setName('번호')
                .setDescription('신청 번호')
                .setMinValue(1)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('환율설정')
        .setDescription('관리자 전용 환율 설정')
        .addNumberOption(o =>
            o.setName('환율')
                .setDescription('1 단위당 환전 금액')
                .setMinValue(0.0001)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('자산순위')
        .setDescription('자산 순위'),

    new SlashCommandBuilder()
        .setName('기업목록')
        .setDescription('기업 목록'),

    new SlashCommandBuilder()
        .setName('선거시작')
        .setDescription('선거 시작')
        .addStringOption(o =>
            o.setName('선거명')
                .setDescription('선거 이름')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('후보등록')
        .setDescription('후보 등록')
        .addStringOption(o =>
            o.setName('선거명')
                .setDescription('선거 이름')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('투표')
        .setDescription('선거 투표')
        .addStringOption(o =>
            o.setName('선거명')
                .setDescription('선거 이름')
                .setRequired(true))
        .addUserOption(o =>
            o.setName('후보')
                .setDescription('투표할 후보')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('선거종료')
        .setDescription('선거 종료 및 결과 공개')
        .addStringOption(o =>
            o.setName('선거명')
                .setDescription('선거 이름')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('로그채널설정')
        .setDescription('관리자 전용 로그 채널 설정')
        .addChannelOption(o =>
            o.setName('채널')
                .setDescription('로그 채널')
                .setRequired(true))

].map(c => c.toJSON());

// ==========================================
// 4. 명령어 등록
// ==========================================

async function registerCommands() {
    const rest = new REST({ version: '10' })
        .setToken(TOKEN);

    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
    );

    console.log('슬래시 명령어 등록 완료');
}

// ==========================================
// 5. 봇 준비
// ==========================================

client.once('ready', () => {
    console.log(`${client.user.tag} 로그인 완료`);
});

// ==========================================
// 6. 명령어 처리
// ==========================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guildId) return;

    const guild = getGuild(interaction.guildId);
    const user = getUser(guild, interaction.user.id);

    const name = interaction.commandName;

    try {

        // 잔액
        if (name === '잔액') {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('💰 자산 정보')
                        .setDescription(
                            `현금: ${money(user.money)}\n` +
                            `면세 자금: ${money(user.taxFreeMoney)}\n` +
                            `은행: ${money(user.bank)}`
                        )
                        .setColor(0x3498db)
                ],
                ephemeral: true
            });
        }

        // 돈 추가
        if (name === '돈추가' || name === '돈제거') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getUser('대상');
            const amount = interaction.options.getInteger('금액');
            const targetData = getUser(guild, target.id);

            if (target.bot) {
                return interaction.reply({
                    content: '봇 계정에는 지급할 수 없습니다.',
                    ephemeral: true
                });
            }

            if (name === '돈추가') {
                if (!Number.isSafeInteger(targetData.money + amount)) {
                    return interaction.reply({
                        content: '금액이 너무 큽니다.',
                        ephemeral: true
                    });
                }

                targetData.money += amount;
            } else {
                if (targetData.money < amount) {
                    return interaction.reply({
                        content: '현금이 부족합니다.',
                        ephemeral: true
                    });
                }

                targetData.money -= amount;
            }

            saveDB();

            await logEvent(
                interaction,
                `💰 ${interaction.user.tag}: ${name}, 대상 ${target.tag}, ${money(amount)}`
            );

            return interaction.reply(
                `${target} ${name === '돈추가' ? '지급' : '회수'} 완료: ${money(amount)}`
            );
        }

        // 은행 메뉴
        if (name === '은행메뉴') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('bank_balance')
                    .setLabel('잔액 확인')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('bank_deposit_help')
                    .setLabel('입금 방법')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('bank_withdraw_help')
                    .setLabel('출금 방법')
                    .setStyle(ButtonStyle.Secondary)
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🏦 은행 메뉴')
                        .setDescription(
                            '아래 버튼을 누르거나 슬래시 명령어를 사용하세요.\n\n' +
                            '`/입금 금액:1000`\n' +
                            '`/출금 금액:1000`\n' +
                            '`/적금가입`'
                        )
                        .setColor(0x3498db)
                ],
                components: [row]
            });
        }

        // 기업 추가
        if (name === '기업추가') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const companyName = interaction.options
                .getString('기업명').trim();

            const chairman = interaction.options.getUser('회장');

            if (companyName.length > 50) {
                return interaction.reply({
                    content: '기업명은 50자 이하여야 합니다.',
                    ephemeral: true
                });
            }

            if (guild.companies[companyName]) {
                return interaction.reply({
                    content: '이미 존재하는 기업입니다.',
                    ephemeral: true
                });
            }

            guild.companies[companyName] = {
                chairmanId: chairman.id,
                totalShares: 0,
                shareOwners: {},
                stockPrice: 1000,
                stockOwners: {}
            };

            saveDB();

            return interaction.reply(
                `🏢 ${companyName} 기업 추가 완료!\n👑 회장: ${chairman}`
            );
        }

        // 기업 삭제
        if (name === '기업삭제') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const companyName = interaction.options.getString('기업명');

            if (!guild.companies[companyName]) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            delete guild.companies[companyName];
            saveDB();

            return interaction.reply(`🗑️ ${companyName} 기업 삭제 완료`);
        }

        // 회장 지정
        if (name === '회장지정') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const company = guild.companies[
                interaction.options.getString('기업명')
            ];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            const chairman = interaction.options.getUser('대상');

            company.chairmanId = chairman.id;
            saveDB();

            return interaction.reply(
                `👑 새 회장: ${chairman}`
            );
        }

        // 지분 발행
        if (name === '지분발행') {
            const companyName = interaction.options.getString('기업명');
            const quantity = interaction.options.getInteger('수량');
            const company = guild.companies[companyName];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            if (!isAdmin(interaction) &&
                !isChairman(company, interaction.user.id)) {
                return interaction.reply({
                    content: '회장 또는 관리자만 발행할 수 있습니다.',
                    ephemeral: true
                });
            }

            company.totalShares += quantity;

            company.shareOwners[interaction.user.id] =
                (company.shareOwners[interaction.user.id] || 0) + quantity;

            user.shares[companyName] =
                (user.shares[companyName] || 0) + quantity;

            saveDB();

            return interaction.reply(
                `📊 ${companyName} 지분 ${quantity}주 발행 완료`
            );
        }

        // 지분 양도
        if (name === '지분양도') {
            const companyName = interaction.options.getString('기업명');
            const target = interaction.options.getUser('대상');
            const quantity = interaction.options.getInteger('수량');
            const company = guild.companies[companyName];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            if (target.bot || target.id === interaction.user.id) {
                return interaction.reply({
                    content: '다른 사용자에게 양도해야 합니다.',
                    ephemeral: true
                });
            }

            const owned = company.shareOwners[interaction.user.id] || 0;

            if (owned < quantity) {
                return interaction.reply({
                    content: '보유 지분이 부족합니다.',
                    ephemeral: true
                });
            }

            company.shareOwners[interaction.user.id] -= quantity;

            company.shareOwners[target.id] =
                (company.shareOwners[target.id] || 0) + quantity;

            getUser(guild, target.id).shares[companyName] =
                (getUser(guild, target.id).shares[companyName] || 0) + quantity;

            user.shares[companyName] =
                Math.max(0, (user.shares[companyName] || 0) - quantity);

            saveDB();

            return interaction.reply(
                `🔄 ${target}에게 ${companyName} 지분 ${quantity}주 양도 완료`
            );
        }

        // 지분 회수
        if (name === '지분회수') {
            const companyName = interaction.options.getString('기업명');
            const target = interaction.options.getUser('대상');
            const quantity = interaction.options.getInteger('수량');
            const company = guild.companies[companyName];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            if (!isAdmin(interaction) &&
                !isChairman(company, interaction.user.id)) {
                return interaction.reply({
                    content: '회장 또는 관리자만 회수할 수 있습니다.',
                    ephemeral: true
                });
            }

            const owned = company.shareOwners[target.id] || 0;

            if (owned < quantity) {
                return interaction.reply({
                    content: '대상의 지분이 부족합니다.',
                    ephemeral: true
                });
            }

            company.shareOwners[target.id] -= quantity;
            company.totalShares -= quantity;

            const targetData = getUser(guild, target.id);

            targetData.shares[companyName] = Math.max(
                0,
                (targetData.shares[companyName] || 0) - quantity
            );

            saveDB();

            return interaction.reply(
                `♻️ ${target}의 ${companyName} 지분 ${quantity}주 회수 완료`
            );
        }

        // 세금 설정
        if (name === '세금설정') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            guild.taxRate = interaction.options.getNumber('세율');

            saveDB();

            return interaction.reply(
                `💸 세율을 ${guild.taxRate}%로 설정했습니다.`
            );
        }

        // 주가 조정
        if (name === '주가조정') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const company = guild.companies[
                interaction.options.getString('기업명')
            ];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            company.stockPrice =
                interaction.options.getInteger('가격');

            saveDB();

            return interaction.reply(
                `📈 주가 변경 완료: ${money(company.stockPrice)}`
            );
        }

        // 주식 매수
        if (name === '주식매수') {
            const companyName = interaction.options.getString('기업명');
            const quantity = interaction.options.getInteger('수량');
            const company = guild.companies[companyName];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            const total = company.stockPrice * quantity;

            if (!Number.isSafeInteger(total)) {
                return interaction.reply({
                    content: '거래 금액이 너무 큽니다.',
                    ephemeral: true
                });
            }

            if (user.money < total) {
                return interaction.reply({
                    content: '현금이 부족합니다.',
                    ephemeral: true
                });
            }

            user.money -= total;

            user.stocks[companyName] =
                (user.stocks[companyName] || 0) + quantity;

            company.stockOwners[interaction.user.id] =
                (company.stockOwners[interaction.user.id] || 0) + quantity;

            saveDB();

            return interaction.reply(
                `📈 ${companyName} ${quantity}주 매수 완료\n` +
                `💸 지출: ${money(total)}`
            );
        }

        // 주식 매도
        if (name === '주식매도') {
            const companyName = interaction.options.getString('기업명');
            const quantity = interaction.options.getInteger('수량');
            const company = guild.companies[companyName];

            if (!company) {
                return interaction.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            const owned = user.stocks[companyName] || 0;

            if (owned < quantity) {
                return interaction.reply({
                    content: '보유 주식이 부족합니다.',
                    ephemeral: true
                });
            }

            const gross = company.stockPrice * quantity;
            const tax = Math.floor(gross * guild.taxRate / 100);
            const net = gross - tax;

            user.stocks[companyName] -= quantity;
            company.stockOwners[interaction.user.id] =
                Math.max(
                    0,
                    (company.stockOwners[interaction.user.id] || 0) - quantity
                );

            user.money += net;

            saveDB();

            return interaction.reply(
                `📉 ${companyName} ${quantity}주 매도 완료\n` +
                `💰 매도 금액: ${money(gross)}\n` +
                `💸 세금: ${money(tax)}\n` +
                `✅ 지급액: ${money(net)}`
            );
        }

        // 인플레이션
        if (name === '인플레이션설정') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            guild.inflation.enabled =
                interaction.options.getBoolean('활성화');

            guild.inflation.rate =
                interaction.options.getNumber('변동률');

            saveDB();

            return interaction.reply(
                `🌍 인플레이션: ${guild.inflation.enabled ? '활성화' : '비활성화'}\n` +
                `변동률: ${guild.inflation.rate}%`
            );
        }

        // 환율 설정
        if (name === '환율설정') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            guild.exchangeRate =
                interaction.options.getNumber('환율');

            saveDB();

            return interaction.reply(
                `💱 환율을 ${guild.exchangeRate}로 설정했습니다.`
            );
        }

        // 환전 신청
        if (name === '환전신청') {
            const amount = interaction.options.getInteger('금액');

            if (user.money < amount) {
                return interaction.reply({
                    content: '현금이 부족합니다.',
                    ephemeral: true
                });
            }

            const id = guild.nextExchangeId++;

            user.money -= amount;

            guild.exchangeRequests[id] = {
                userId: interaction.user.id,
                amount,
                status: 'pending'
            };

            saveDB();

            await logEvent(
                interaction,
                `💱 환전 신청 #${id}: ${interaction.user.tag}, ${money(amount)}`
            );

            return interaction.reply(
                `💱 환전 신청 완료!\n신청 번호: **${id}**\n관리자 승인을 기다려 주세요.`
            );
        }

        // 환전 승인 및 거절
        if (name === '환전승인' || name === '환전거절') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const id = interaction.options.getInteger('번호');
            const request = guild.exchangeRequests[id];

            if (!request || request.status !== 'pending') {
                return interaction.reply({
                    content: '처리할 수 있는 신청이 없습니다.',
                    ephemeral: true
                });
            }

            const targetData = getUser(guild, request.userId);

            if (name === '환전승인') {
                const converted = Math.floor(
                    request.amount * guild.exchangeRate
                );

                if (!Number.isSafeInteger(targetData.money + converted)) {
                    return interaction.reply({
                        content: '환전 금액이 너무 큽니다.',
                        ephemeral: true
                    });
                }

                targetData.money += converted;
                request.status = 'approved';
                request.converted = converted;
            } else {
                targetData.money += request.amount;
                request.status = 'rejected';
            }

            saveDB();

            return interaction.reply(
                name === '환전승인'
                    ? `✅ 환전 승인 완료: ${money(request.amount)} → ${money(request.converted)}`
                    : `❌ 환전 거절 및 원금 반환 완료: ${money(request.amount)}`
            );
        }

        // 입금
        if (name === '입금') {
            const amount = interaction.options.getInteger('금액');

            if (user.money < amount) {
                return interaction.reply({
                    content: '현금이 부족합니다.',
                    ephemeral: true
                });
            }

            user.money -= amount;
            user.bank += amount;

            saveDB();

            return interaction.reply(`🏦 ${money(amount)} 입금 완료`);
        }

        // 출금
        if (name === '출금') {
            const amount = interaction.options.getInteger('금액');

            if (user.bank < amount) {
                return interaction.reply({
                    content: '은행 잔액이 부족합니다.',
                    ephemeral: true
                });
            }

            user.bank -= amount;
            user.money += amount;

            saveDB();

            return interaction.reply(`💵 ${money(amount)} 출금 완료`);
        }

        // 적금 가입
        if (name === '적금가입') {
            const amount = interaction.options.getInteger('금액');
            const months = interaction.options.getInteger('기간');

            if (user.money < amount) {
                return interaction.reply({
                    content: '현금이 부족합니다.',
                    ephemeral: true
                });
            }

            const rate = months === 1 ? 0.021 : 0.03;

            const maturity = Date.now() +
                months * 30 * 24 * 60 * 60 * 1000;

            user.money -= amount;

            user.savings.push({
                principal: amount,
                interest: Math.floor(amount * rate),
                maturity,
                paid: false
            });

            saveDB();

            return interaction.reply(
                `📒 적금 가입 완료\n` +
                `가입 금액: ${money(amount)}\n` +
                `예정 이자: ${money(Math.floor(amount * rate))}\n` +
                `만기: <t:${Math.floor(maturity / 1000)}:F>`
            );
        }

        // 적금 조회 및 만기 정산
        if (name === '적금조회') {
            let changed = false;

            for (const saving of user.savings) {
                if (!saving.paid && Date.now() >= saving.maturity) {
                    const gross = saving.principal + saving.interest;
                    const tax = Math.floor(
                        saving.interest * guild.taxRate / 100
                    );

                    user.money += gross - tax;
                    saving.paid = true;
                    saving.tax = tax;
                    changed = true;
                }
            }

            if (changed) saveDB();

            const active = user.savings.filter(s => !s.paid);

            return interaction.reply({
                content: active.length
                    ? active.map(s =>
                        `가입액 ${money(s.principal)} · 만기 <t:${Math.floor(s.maturity / 1000)}:F>`
                    ).join('\n')
                    : '현재 가입 중인 적금이 없습니다.',
                ephemeral: true
            });
        }

        // 대출 신청
        if (name === '대출신청') {
            const amount = interaction.options.getInteger('금액');

            const outstanding = user.loans.reduce(
                (sum, loan) => sum + loan.remaining,
                0
            );

            if (outstanding + amount > 1_000_000) {
                return interaction.reply({
                    content: '대출 한도는 100만 원입니다.',
                    ephemeral: true
                });
            }

            user.loans.push({
                remaining: amount,
                dueAt: Date.now() + 30 * 24 * 60 * 60 * 1000
            });

            user.money += amount;

            saveDB();

            return interaction.reply(
                `🏧 대출 완료: ${money(amount)}\n` +
                `상환 기한: <t:${Math.floor(user.loans[user.loans.length - 1].dueAt / 1000)}:F>`
            );
        }

        // 대출 상환
        if (name === '대출상환') {
            const amount = interaction.options.getInteger('금액');

            const outstanding = user.loans.reduce(
                (sum, loan) => sum + loan.remaining,
                0
            );

            if (outstanding === 0) {
                return interaction.reply({
                    content: '상환할 대출이 없습니다.',
                    ephemeral: true
                });
            }

            if (user.money < amount) {
                return interaction.reply({
                    content: '현금이 부족합니다.',
                    ephemeral: true
                });
            }

            let payment = Math.min(amount, outstanding);
            const originalPayment = payment;

            for (const loan of user.loans) {
                const paid = Math.min(loan.remaining, payment);
                loan.remaining -= paid;
                payment -= paid;

                if (payment <= 0) break;
            }

            user.loans = user.loans.filter(
                loan => loan.remaining > 0
            );

            user.money -= originalPayment;

            saveDB();

            return interaction.reply(
                `🏧 상환 완료: ${money(originalPayment)}`
            );
        }

        // 자산 순위
        if (name === '자산순위') {
            const ranking = Object.entries(guild.users)
                .map(([id, data]) => ({
                    id,
                    total: data.money + data.bank + data.taxFreeMoney
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🏆 자산 리더보드')
                        .setDescription(
                            ranking.length
                                ? ranking.map((r, i) =>
                                    `${i + 1}위 <@${r.id}> — ${money(r.total)}`
                                ).join('\n')
                                : '아직 데이터가 없습니다.'
                        )
                        .setColor(0xf1c40f)
                ]
            });
        }

        // 기업 목록
        if (name === '기업목록') {
            const names = Object.entries(guild.companies);

            return interaction.reply(
                names.length
                    ? names.map(([companyName, company]) =>
                        `🏢 **${companyName}**\n` +
                        `회장: <@${company.chairmanId}>\n` +
                        `주가: ${money(company.stockPrice)}\n` +
                        `발행 지분: ${company.totalShares}`
                    ).join('\n\n')
                    : '등록된 기업이 없습니다.'
            );
        }

        // 선거 시작
        if (name === '선거시작') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const electionName = interaction.options
                .getString('선거명').trim();

            if (guild.elections[electionName]?.active) {
                return interaction.reply({
                    content: '이미 진행 중인 선거입니다.',
                    ephemeral: true
                });
            }

            guild.elections[electionName] = {
                active: true,
                candidates: [],
                votes: {}
            };

            saveDB();

            return interaction.reply(
                `🗳️ **${electionName}** 선거가 시작되었습니다.`
            );
        }

        // 후보 등록
        if (name === '후보등록') {
            const electionName = interaction.options.getString('선거명');
            const election = guild.elections[electionName];

            if (!election?.active) {
                return interaction.reply({
                    content: '진행 중인 선거가 없습니다.',
                    ephemeral: true
                });
            }

            if (election.candidates.includes(interaction.user.id)) {
                return interaction.reply({
                    content: '이미 후보로 등록되었습니다.',
                    ephemeral: true
                });
            }

            election.candidates.push(interaction.user.id);

            saveDB();

            return interaction.reply(
                `🗳️ ${interaction.user} 후보 등록 완료`
            );
        }

        // 투표
        if (name === '투표') {
            const electionName = interaction.options.getString('선거명');
            const candidate = interaction.options.getUser('후보');
            const election = guild.elections[electionName];

            if (!election?.active) {
                return interaction.reply({
                    content: '진행 중인 선거가 없습니다.',
                    ephemeral: true
                });
            }

            if (!election.candidates.includes(candidate.id)) {
                return interaction.reply({
                    content: '해당 사용자는 후보가 아닙니다.',
                    ephemeral: true
                });
            }

            if (election.votes[interaction.user.id]) {
                return interaction.reply({
                    content: '이미 투표했습니다.',
                    ephemeral: true
                });
            }

            election.votes[interaction.user.id] = candidate.id;

            saveDB();

            return interaction.reply({
                content: `✅ ${candidate} 후보에게 투표했습니다.`,
                ephemeral: true
            });
        }

        // 선거 종료
        if (name === '선거종료') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const electionName = interaction.options.getString('선거명');
            const election = guild.elections[electionName];

            if (!election?.active) {
                return interaction.reply({
                    content: '진행 중인 선거가 없습니다.',
                    ephemeral: true
                });
            }

            election.active = false;

            const counts = {};

            for (const candidateId of election.candidates) {
                counts[candidateId] = 0;
            }

            for (const candidateId of Object.values(election.votes)) {
                counts[candidateId] =
                    (counts[candidateId] || 0) + 1;
            }

            const results = Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([id, count]) =>
                    `<@${id}> — ${count}표`
                );

            saveDB();

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🗳️ ${electionName} 선거 결과`)
                        .setDescription(
                            results.length
                                ? results.join('\n')
                                : '등록된 후보가 없습니다.'
                        )
                        .setColor(0x2ecc71)
                ]
            });
        }

        // 로그 채널
        if (name === '로그채널설정') {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const channel = interaction.options.getChannel('채널');

            if (!channel.isTextBased()) {
                return interaction.reply({
                    content: '텍스트 채널을 선택해 주세요.',
                    ephemeral: true
                });
            }

            guild.settings.logChannelId = channel.id;

            saveDB();

            return interaction.reply(
                `📋 로그 채널 설정 완료: ${channel}`
            );
        }

    } catch (error) {
        console.error(error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '오류가 발생했습니다. 관리자에게 문의하세요.',
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ==========================================
// 7. 버튼 처리
// ==========================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (!interaction.guildId) return;

    const guild = getGuild(interaction.guildId);
    const user = getUser(guild, interaction.user.id);

    if (interaction.customId === 'bank_balance') {
        return interaction.reply({
            content:
                `💵 현금: ${money(user.money)}\n` +
                `🏦 은행: ${money(user.bank)}`,
            ephemeral: true
        });
    }

    if (interaction.customId === 'bank_deposit_help') {
        return interaction.reply({
            content: '입금하려면 `/입금 금액:1000` 명령어를 사용하세요.',
            ephemeral: true
        });
    }

    if (interaction.customId === 'bank_withdraw_help') {
        return interaction.reply({
            content: '출금하려면 `/출금 금액:1000` 명령어를 사용하세요.',
            ephemeral: true
        });
    }
});

// ==========================================
// 8. 주가 자동 변동
// ==========================================

setInterval(() => {
    for (const guild of Object.values(db)) {
        for (const company of Object.values(guild.companies)) {
            const change = Math.random() * 0.10 - 0.05;

            let multiplier = 1 + change;

            if (guild.inflation.enabled) {
                multiplier *=
                    1 + guild.inflation.rate / 100;
            }

            company.stockPrice = Math.max(
                1,
                Math.floor(company.stockPrice * multiplier)
            );
        }
    }

    try {
        saveDB();
    } catch (error) {
        console.error('주가 자동 저장 오류:', error);
    }
}, 60 * 60 * 1000);

// ==========================================
// 9. 자동 저장
// ==========================================

setInterval(() => {
    try {
        saveDB();
    } catch (error) {
        console.error('자동 저장 오류:', error);
    }
}, 30_000);

// ==========================================
// 10. 실행
// ==========================================

(async () => {
    await registerCommands();
    await client.login(TOKEN);
})();
