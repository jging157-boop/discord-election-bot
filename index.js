const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ========================================
// 1. 기본 설정
// ========================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('DISCORD_TOKEN 또는 CLIENT_ID가 없습니다.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        console.error('데이터 파일을 읽을 수 없습니다.', error);
        process.exit(1);
    }
}

function save() {
    const temp = DATA_FILE + '.tmp';

    fs.writeFileSync(
        temp,
        JSON.stringify(db, null, 2),
        'utf8'
    );

    fs.renameSync(temp, DATA_FILE);
}

function serverData(guildId) {
    if (!db[guildId]) {
        db[guildId] = {
            users: {},
            companies: {},
            elections: {},
            exchangeRequests: {},
            nextExchangeId: 1,
            nextElectionId: 1,
            tax: 20,
            exchangeRate: 1,
            inflation: 0,
            inflationEnabled: false,
            bankEnabled: true,
            stockEnabled: true,
            logChannelId: null
        };
    }

    return db[guildId];
}

function getUser(server, id) {
    if (!server.users[id]) {
        server.users[id] = {
            money: 0,
            bank: 0,
            taxFreeMoney: 0,
            savings: [],
            loans: [],
            shares: {},
            stocks: {}
        };
    }

    return server.users[id];
}

function admin(i) {
    return i.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    ) ?? false;
}

function fmt(n) {
    return Math.floor(n).toLocaleString('ko-KR') + '원';
}

function validAmount(n) {
    return Number.isSafeInteger(n) && n > 0;
}

async function logAction(server, message) {
    if (!server.logChannelId) return;

    const channel = await client.channels.fetch(
        server.logChannelId
    ).catch(() => null);

    if (channel && channel.isTextBased()) {
        await channel.send(message).catch(console.error);
    }
}

// ========================================
// 2. 슬래시 명령어
// ========================================

const definitions = [
    new SlashCommandBuilder()
        .setName('핑')
        .setDescription('봇 응답 확인'),

    new SlashCommandBuilder()
        .setName('잔액')
        .setDescription('내 자산 확인'),

    new SlashCommandBuilder()
        .setName('돈추가')
        .setDescription('관리자 돈 추가')
        .addUserOption(o =>
            o.setName('대상').setDescription('대상').setRequired(true))
        .addIntegerOption(o =>
            o.setName('금액').setDescription('금액').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('돈제거')
        .setDescription('관리자 돈 제거')
        .addUserOption(o =>
            o.setName('대상').setDescription('대상').setRequired(true))
        .addIntegerOption(o =>
            o.setName('금액').setDescription('금액').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('면세돈추가')
        .setDescription('관리자 면세 자금 추가')
        .addUserOption(o =>
            o.setName('대상').setDescription('대상').setRequired(true))
        .addIntegerOption(o =>
            o.setName('금액').setDescription('금액').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('입금')
        .setDescription('은행 입금')
        .addIntegerOption(o =>
            o.setName('금액').setDescription('금액').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('출금')
        .setDescription('은행 출금')
        .addIntegerOption(o =>
            o.setName('금액').setDescription('금액').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('적금가입')
        .setDescription('적금 가입')
        .addIntegerOption(o =>
            o.setName('금액').setDescription('가입 금액').setMinValue(1).setRequired(true))
        .addIntegerOption(o =>
            o.setName('기간').setDescription('기간(개월)').addChoices(
                { name: '1개월', value: 1 },
                { name: '3개월', value: 3 }
            ).setRequired(true)),

    new SlashCommandBuilder()
        .setName('대출')
        .setDescription('대출 신청')
        .addIntegerOption(o =>
            o.setName('금액').setDescription('대출 금액').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('대출상환')
        .setDescription('대출 상환'),

    new SlashCommandBuilder()
        .setName('기업추가')
        .setDescription('기업 추가 및 회장 지정')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addUserOption(o =>
            o.setName('회장').setDescription('회장').setRequired(true)),

    new SlashCommandBuilder()
        .setName('기업삭제')
        .setDescription('기업 삭제')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true)),

    new SlashCommandBuilder()
        .setName('기업목록')
        .setDescription('기업 목록 확인'),

    new SlashCommandBuilder()
        .setName('지분발행')
        .setDescription('회장 또는 관리자 지분 발행')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addUserOption(o =>
            o.setName('대상').setDescription('지분을 받을 사람').setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량').setDescription('지분 수량').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('지분양도')
        .setDescription('내 지분 양도')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addUserOption(o =>
            o.setName('대상').setDescription('받는 사람').setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량').setDescription('지분 수량').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('지분회수')
        .setDescription('회장 또는 관리자 지분 회수')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addUserOption(o =>
            o.setName('대상').setDescription('대상').setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량').setDescription('회수 수량').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('주식목록')
        .setDescription('기업 주가 확인'),

    new SlashCommandBuilder()
        .setName('주식매수')
        .setDescription('주식 매수')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량').setDescription('수량').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('주식매도')
        .setDescription('주식 매도')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addIntegerOption(o =>
            o.setName('수량').setDescription('수량').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('주가조정')
        .setDescription('관리자 주가 조정')
        .addStringOption(o =>
            o.setName('기업명').setDescription('기업명').setRequired(true))
        .addIntegerOption(o =>
            o.setName('주가').setDescription('새 주가').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('세금설정')
        .setDescription('세율 설정')
        .addNumberOption(o =>
            o.setName('세율').setDescription('세율(%)').setMinValue(0).setMaxValue(100).setRequired(true)),

    new SlashCommandBuilder()
        .setName('인플레이션')
        .setDescription('인플레이션 설정')
        .addNumberOption(o =>
            o.setName('수치').setDescription('인플레이션 수치(%)').setMinValue(0).setMaxValue(100).setRequired(true)),

    new SlashCommandBuilder()
        .setName('환율설정')
        .setDescription('관리자 환율 설정')
        .addNumberOption(o =>
            o.setName('환율').setDescription('1단위당 원화').setMinValue(0.01).setRequired(true)),

    new SlashCommandBuilder()
        .setName('환전신청')
        .setDescription('환전 신청')
        .addNumberOption(o =>
            o.setName('외화').setDescription('환전할 외화 수량').setMinValue(0.01).setRequired(true)),

    new SlashCommandBuilder()
        .setName('환전승인')
        .setDescription('관리자 환전 승인')
        .addIntegerOption(o =>
            o.setName('번호').setDescription('신청 번호').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('환전거절')
        .setDescription('관리자 환전 거절')
        .addIntegerOption(o =>
            o.setName('번호').setDescription('신청 번호').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
        .setName('로그채널')
        .setDescription('관리자 로그 채널 설정')
        .addChannelOption(o =>
            o.setName('채널').setDescription('로그 채널').setRequired(true)),

    new SlashCommandBuilder()
        .setName('자산순위')
        .setDescription('자산 리더보드'),

    new SlashCommandBuilder()
        .setName('선거시작')
        .setDescription('선거 시작')
        .addStringOption(o =>
            o.setName('선거명').setDescription('선거 이름').setRequired(true))
        .addStringOption(o =>
            o.setName('후보목록').setDescription('쉼표로 후보 구분').setRequired(true)),

    new SlashCommandBuilder()
        .setName('투표')
        .setDescription('선거 투표')
        .addIntegerOption(o =>
            o.setName('번호').setDescription('선거 번호').setMinValue(1).setRequired(true))
        .addStringOption(o =>
            o.setName('후보').setDescription('후보 이름').setRequired(true)),

    new SlashCommandBuilder()
        .setName('선거종료')
        .setDescription('선거 종료 및 결과 공개')
        .addIntegerOption(o =>
            o.setName('번호').setDescription('선거 번호').setMinValue(1).setRequired(true))
].map(c => c.toJSON());

// ========================================
// 3. 명령어 등록 및 로그인
// ========================================

async function start() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    console.log('명령어 등록 중...');

    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: definitions }
    );

    console.log('명령어 등록 완료');

    await client.login(TOKEN);
}

client.once('ready', () => {
    console.log(`로그인 성공: ${client.user.tag}`);
});

// ========================================
// 4. 명령어 처리
// ========================================

client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return;

    if (!i.guildId) {
        return i.reply({
            content: '서버에서 사용해 주세요.',
            ephemeral: true
        });
    }

    const s = serverData(i.guildId);
    const u = getUser(s, i.user.id);

    const name = i.commandName;

    try {
        console.log(`/${name} | ${i.guildId} | ${i.user.id}`);

        if (name === '핑') {
            return i.reply('🏓 퐁! 봇이 정상 작동 중입니다.');
        }

        if (name === '잔액') {
            return i.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('💰 자산 현황')
                        .addFields(
                            { name: '현금', value: fmt(u.money), inline: true },
                            { name: '은행', value: fmt(u.bank), inline: true },
                            { name: '면세 자금', value: fmt(u.taxFreeMoney), inline: true },
                            { name: '세율', value: `${s.tax}%`, inline: true },
                            { name: '환율', value: `${s.exchangeRate}`, inline: true }
                        )
                        .setColor(0x3498db)
                ],
                ephemeral: true
            });
        }

        // 관리자 돈 추가 / 제거 / 면세 자금
        if (['돈추가', '돈제거', '면세돈추가'].includes(name)) {
            if (!admin(i)) {
                return i.reply({
                    content: '❌ 관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const target = i.options.getUser('대상');
            const amount = i.options.getInteger('금액');

            if (target.bot || !validAmount(amount)) {
                return i.reply({
                    content: '잘못된 대상 또는 금액입니다.',
                    ephemeral: true
                });
            }

            const t = getUser(s, target.id);

            if (name === '돈추가') {
                t.money += amount;
            } else if (name === '면세돈추가') {
                t.taxFreeMoney += amount;
            } else {
                if (t.money < amount) {
                    return i.reply({
                        content: '대상의 현금이 부족합니다.',
                        ephemeral: true
                    });
                }

                t.money -= amount;
            }

            save();

            await logAction(s, `💰 ${i.user.tag}: ${name} ${target.tag} ${fmt(amount)}`);

            return i.reply(`✅ ${target} 처리 완료: ${fmt(amount)}`);
        }

        // 은행 입출금
        if (name === '입금' || name === '출금') {
            if (!s.bankEnabled) {
                return i.reply({
                    content: '🏦 은행이 현재 중단되었습니다.',
                    ephemeral: true
                });
            }

            const amount = i.options.getInteger('금액');

            if (name === '입금') {
                if (u.money < amount) {
                    return i.reply({
                        content: '현금이 부족합니다.',
                        ephemeral: true
                    });
                }

                u.money -= amount;
                u.bank += amount;
            } else {
                if (u.bank < amount) {
                    return i.reply({
                        content: '은행 잔액이 부족합니다.',
                        ephemeral: true
                    });
                }

                u.bank -= amount;
                u.money += amount;
            }

            save();

            return i.reply(`✅ ${fmt(amount)} ${name} 완료`);
        }

        // 적금
        if (name === '적금가입') {
            if (!s.bankEnabled) {
                return i.reply({
                    content: '은행이 중단되었습니다.',
                    ephemeral: true
                });
            }

            const amount = i.options.getInteger('금액');
            const months = i.options.getInteger('기간');

            if (u.money < amount) {
                return i.reply({
                    content: '현금이 부족합니다.',
                    ephemeral: true
                });
            }

            const rate = months === 1 ? 0.021 : 0.03;

            u.money -= amount;

            u.savings.push({
                principal: amount,
                rate,
                months,
                dueAt: Date.now() + months * 30 * 86400000
            });

            save();

            return i.reply(
                `🏦 ${months}개월 적금 가입 완료!\n` +
                `원금: ${fmt(amount)}\n` +
                `예정 이자: ${fmt(amount * rate)}\n` +
                `만기 시 세금 ${s.tax}%가 적용됩니다.`
            );
        }

        // 만기 적금 수령
        if (name === '잔액') {
            // 잔액 명령어는 위에서 처리됩니다.
        }

        // 대출
        if (name === '대출') {
            if (!s.bankEnabled) {
                return i.reply({
                    content: '은행이 중단되었습니다.',
                    ephemeral: true
                });
            }

            const amount = i.options.getInteger('금액');

            if (amount > 1000000) {
                return i.reply({
                    content: '대출 한도는 1,000,000원입니다.',
                    ephemeral: true
                });
            }

            const debt = Math.ceil(amount * 1.1);

            u.money += amount;

            u.loans.push({
                principal: amount,
                debt,
                dueAt: Date.now() + 7 * 86400000
            });

            save();

            return i.reply(
                `🏦 대출 완료: ${fmt(amount)}\n` +
                `상환 예정액(이자 10% 포함): ${fmt(debt)}\n` +
                `상환 기한: 7일`
            );
        }

        if (name === '대출상환') {
            const debt = u.loans.reduce((sum, loan) => sum + loan.debt, 0);

            if (debt === 0) {
                return i.reply({
                    content: '상환할 대출이 없습니다.',
                    ephemeral: true
                });
            }

            if (u.money < debt) {
                return i.reply({
                    content: `상환액 ${fmt(debt)}이 필요합니다.`,
                    ephemeral: true
                });
            }

            u.money -= debt;
            u.loans = [];

            save();

            return i.reply(`✅ 대출 전액 상환 완료: ${fmt(debt)}`);
        }

        // 기업 추가
        if (name === '기업추가') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const company = i.options.getString('기업명').trim();
            const chairman = i.options.getUser('회장');

            if (!company || company.length > 50 || s.companies[company]) {
                return i.reply({
                    content: '기업명이 잘못되었거나 이미 존재합니다.',
                    ephemeral: true
                });
            }

            s.companies[company] = {
                chairmanId: chairman.id,
                stockPrice: 1000,
                totalShares: 0,
                shareOwners: {},
                stockOwners: {}
            };

            save();

            await logAction(s, `🏢 기업 추가: ${company} / 회장 ${chairman.tag}`);

            return i.reply(`🏢 기업 ${company} 추가 완료!\n회장: ${chairman}`);
        }

        // 기업 삭제
        if (name === '기업삭제') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const company = i.options.getString('기업명');

            if (!s.companies[company]) {
                return i.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            delete s.companies[company];

            save();

            return i.reply(`🗑️ ${company} 기업 삭제 완료`);
        }

        // 기업 목록
        if (name === '기업목록' || name === '주식목록') {
            const entries = Object.entries(s.companies);

            if (!entries.length) {
                return i.reply('등록된 기업이 없습니다.');
            }

            return i.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(name === '기업목록' ? '🏢 기업 목록' : '📈 주식시장')
                        .setDescription(entries.map(([company, c]) =>
                            `**${company}**\n` +
                            `회장: <@${c.chairmanId}>\n` +
                            `주가: ${fmt(c.stockPrice)}\n` +
                            `발행 지분: ${c.totalShares}`
                        ).join('\n\n'))
                        .setColor(0x2ecc71)
                ]
            });
        }

        // 지분 발행
        if (name === '지분발행') {
            const company = i.options.getString('기업명');
            const target = i.options.getUser('대상');
            const amount = i.options.getInteger('수량');
            const c = s.companies[company];

            if (!c) {
                return i.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            if (!admin(i) && c.chairmanId !== i.user.id) {
                return i.reply({
                    content: '회장 또는 관리자만 발행할 수 있습니다.',
                    ephemeral: true
                });
            }

            c.shareOwners[target.id] =
                (c.shareOwners[target.id] || 0) + amount;

            c.totalShares += amount;

            save();

            return i.reply(
                `📊 ${company} 지분 ${amount}개를 ${target}에게 발행했습니다.`
            );
        }

        // 지분 양도
        if (name === '지분양도') {
            const company = i.options.getString('기업명');
            const target = i.options.getUser('대상');
            const amount = i.options.getInteger('수량');
            const c = s.companies[company];

            if (!c || target.bot || target.id === i.user.id) {
                return i.reply({
                    content: '기업 또는 양도 대상이 올바르지 않습니다.',
                    ephemeral: true
                });
            }

            const owned = c.shareOwners[i.user.id] || 0;

            if (owned < amount) {
                return i.reply({
                    content: '보유 지분이 부족합니다.',
                    ephemeral: true
                });
            }

            c.shareOwners[i.user.id] -= amount;
            c.shareOwners[target.id] =
                (c.shareOwners[target.id] || 0) + amount;

            save();

            return i.reply(
                `📊 ${company} 지분 ${amount}개를 ${target}에게 양도했습니다.`
            );
        }

        // 지분 회수
        if (name === '지분회수') {
            const company = i.options.getString('기업명');
            const target = i.options.getUser('대상');
            const amount = i.options.getInteger('수량');
            const c = s.companies[company];

            if (!c) {
                return i.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            if (!admin(i) && c.chairmanId !== i.user.id) {
                return i.reply({
                    content: '회장 또는 관리자만 회수할 수 있습니다.',
                    ephemeral: true
                });
            }

            if ((c.shareOwners[target.id] || 0) < amount) {
                return i.reply({
                    content: '대상의 지분이 부족합니다.',
                    ephemeral: true
                });
            }

            c.shareOwners[target.id] -= amount;
            c.totalShares -= amount;

            save();

            return i.reply(
                `📊 ${target}의 ${company} 지분 ${amount}개를 회수했습니다.`
            );
        }

        // 주식 매수
        if (name === '주식매수') {
            if (!s.stockEnabled) {
                return i.reply({
                    content: '주식 거래가 중단되었습니다.',
                    ephemeral: true
                });
            }

            const company = i.options.getString('기업명');
            const amount = i.options.getInteger('수량');
            const c = s.companies[company];

            if (!c) {
                return i.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            const total = c.stockPrice * amount;

            if (!Number.isSafeInteger(total)) {
                return i.reply({
                    content: '거래 금액이 너무 큽니다.',
                    ephemeral: true
                });
            }

            if (u.money < total) {
                return i.reply({
                    content: `현금이 부족합니다. 필요 금액: ${fmt(total)}`,
                    ephemeral: true
                });
            }

            u.money -= total;
            u.stocks[company] = (u.stocks[company] || 0) + amount;

            c.stockOwners[i.user.id] =
                (c.stockOwners[i.user.id] || 0) + amount;

            save();

            await logAction(s, `📈 매수: ${i.user.tag} / ${company} / ${amount}주`);

            return i.reply(
                `📈 ${company} ${amount}주 매수 완료!\n` +
                `결제 금액: ${fmt(total)}`
            );
        }

        // 주식 매도
        if (name === '주식매도') {
            if (!s.stockEnabled) {
                return i.reply({
                    content: '주식 거래가 중단되었습니다.',
                    ephemeral: true
                });
            }

            const company = i.options.getString('기업명');
            const amount = i.options.getInteger('수량');
            const c = s.companies[company];

            if (!c) {
                return i.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            if ((u.stocks[company] || 0) < amount) {
                return i.reply({
                    content: '보유 주식이 부족합니다.',
                    ephemeral: true
                });
            }

            const gross = c.stockPrice * amount;
            const tax = Math.floor(gross * s.tax / 100);
            const net = gross - tax;

            if (!Number.isSafeInteger(gross)) {
                return i.reply({
                    content: '거래 금액이 너무 큽니다.',
                    ephemeral: true
                });
            }

            u.stocks[company] -= amount;
            c.stockOwners[i.user.id] =
                Math.max(0, (c.stockOwners[i.user.id] || 0) - amount);

            u.money += net;

            save();

            await logAction(s, `📉 매도: ${i.user.tag} / ${company} / ${amount}주 / 세금 ${fmt(tax)}`);

            return i.reply(
                `📉 ${company} ${amount}주 매도 완료!\n` +
                `매도 금액: ${fmt(gross)}\n` +
                `세금: ${fmt(tax)}\n` +
                `실수령: ${fmt(net)}`
            );
        }

        // 주가 조정
        if (name === '주가조정') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            const company = i.options.getString('기업명');
            const price = i.options.getInteger('주가');
            const c = s.companies[company];

            if (!c) {
                return i.reply({
                    content: '기업을 찾을 수 없습니다.',
                    ephemeral: true
                });
            }

            c.stockPrice = price;

            save();

            await logAction(s, `📈 주가 조정: ${company} → ${fmt(price)}`);

            return i.reply(
                `📈 ${company} 주가를 ${fmt(price)}로 변경했습니다.`
            );
        }

        // 세금 설정
        if (name === '세금설정') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            s.tax = i.options.getNumber('세율');

            save();

            return i.reply(`💸 세율을 ${s.tax}%로 설정했습니다.`);
        }

        // 인플레이션 설정
        if (name === '인플레이션') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            s.inflation = i.options.getNumber('수치');
            s.inflationEnabled = s.inflation > 0;

            if (s.inflationEnabled) {
                s.bankEnabled = false;
                s.stockEnabled = false;

                for (const data of Object.values(s.users)) {
                    for (const [company, amount] of Object.entries(data.stocks)) {
                        if (amount > 0) {
                            data.stocks[company] = amount - 1;

                            const c = s.companies[company];

                            if (c) {
                                c.stockOwners[data.id] =
                                    Math.max(0, (c.stockOwners[data.id] || 0) - 1);
                            }
                        }
                    }
                }
            } else {
                s.bankEnabled = true;
                s.stockEnabled = true;
            }

            save();

            await logAction(
                s,
                `🌍 인플레이션 설정: ${s.inflation}% / 은행 및 주식 ${s.inflationEnabled ? '중단' : '재개'}`
            );

            return i.reply(
                `🌍 인플레이션 ${s.inflation}% 설정 완료.\n` +
                `은행: ${s.bankEnabled ? '운영' : '중단'}\n` +
                `주식: ${s.stockEnabled ? '운영' : '중단'}`
            );
        }

        // 환율 설정
        if (name === '환율설정') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 사용할 수 있습니다.',
                    ephemeral: true
                });
            }

            s.exchangeRate = i.options.getNumber('환율');

            save();

            return i.reply(`💱 환율을 ${s.exchangeRate}원으로 설정했습니다.`);
        }

        // 환전 신청
        if (name === '환전신청') {
            const foreign = i.options.getNumber('외화');
            const cost = Math.ceil(foreign * s.exchangeRate);

            if (!Number.isSafeInteger(cost) || u.money < cost) {
                return i.reply({
                    content: `환전 신청 금액이 잘못되었거나 현금이 부족합니다. 필요 금액: ${fmt(cost)}`,
                    ephemeral: true
                });
            }

            const id = s.nextExchangeId++;

            s.exchangeRequests[id] = {
                userId: i.user.id,
                foreign,
                cost,
                status: 'pending'
            };

            save();

            await logAction(
                s,
                `💱 환전 신청 #${id}: ${i.user.tag} / ${foreign} 외화 / ${fmt(cost)}`
            );

            return i.reply(
                `💱 환전 신청 완료!\n` +
                `신청 번호: ${id}\n` +
                `외화: ${foreign}\n` +
                `필요 금액: ${fmt(cost)}\n` +
                `관리자 승인을 기다려 주세요.`
            );
        }

        // 환전 승인 및 거절
        if (name === '환전승인' || name === '환전거절') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 승인 또는 거절할 수 있습니다.',
                    ephemeral: true
                });
            }

            const id = i.options.getInteger('번호');
            const request = s.exchangeRequests[id];

            if (!request || request.status !== 'pending') {
                return i.reply({
                    content: '대기 중인 환전 신청이 없습니다.',
                    ephemeral: true
                });
            }

            const target = getUser(s, request.userId);

            if (name === '환전승인') {
                if (target.money < request.cost) {
                    return i.reply({
                        content: '신청자의 현금이 부족해 승인할 수 없습니다.',
                        ephemeral: true
                    });
                }

                target.money -= request.cost;

                target.taxFreeMoney += Math.floor(
                    request.foreign * s.exchangeRate
                );

                request.status = 'approved';
            } else {
                request.status = 'rejected';
            }

            save();

            await logAction(s, `💱 환전 신청 #${id}: ${request.status}`);

            return i.reply(
                `환전 신청 #${id} ${request.status === 'approved' ? '승인' : '거절'} 완료`
            );
        }

        // 로그 채널
        if (name === '로그채널') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 설정할 수 있습니다.',
                    ephemeral: true
                });
            }

            const channel = i.options.getChannel('채널');

            if (!channel.isTextBased()) {
                return i.reply({
                    content: '텍스트 채널을 선택해 주세요.',
                    ephemeral: true
                });
            }

            s.logChannelId = channel.id;

            save();

            return i.reply(`📝 로그 채널을 ${channel}로 설정했습니다.`);
        }

        // 자산 순위
        if (name === '자산순위') {
            const ranking = Object.entries(s.users)
                .map(([id, data]) => ({
                    id,
                    total: data.money +
                        data.bank +
                        data.taxFreeMoney +
                        data.savings.reduce((sum, item) => sum + item.principal, 0)
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);

            return i.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🏆 자산 순위')
                        .setDescription(
                            ranking.length
                                ? ranking.map((r, idx) =>
                                    `${idx + 1}위 <@${r.id}> — ${fmt(r.total)}`
                                ).join('\n')
                                : '등록된 자산이 없습니다.'
                        )
                        .setColor(0xf1c40f)
                ]
            });
        }

        // 선거 시작
        if (name === '선거시작') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 선거를 시작할 수 있습니다.',
                    ephemeral: true
                });
            }

            const title = i.options.getString('선거명').trim();

            const candidates = i.options.getString('후보목록')
                .split(',')
                .map(v => v.trim())
                .filter(Boolean);

            if (!title || candidates.length < 2 || candidates.length > 20) {
                return i.reply({
                    content: '후보는 2명 이상 20명 이하로 입력해 주세요.',
                    ephemeral: true
                });
            }

            const id = s.nextElectionId++;

            s.elections[id] = {
                title,
                candidates,
                votes: {},
                ended: false
            };

            save();

            return i.reply(
                `🗳️ 선거 시작!\n` +
                `선거 번호: ${id}\n` +
                `선거명: ${title}\n` +
                `후보:\n${candidates.map((c, idx) => `${idx + 1}. ${c}`).join('\n')}\n\n` +
                `투표 명령어: /투표 번호:${id} 후보:후보이름`
            );
        }

        // 투표
        if (name === '투표') {
            const id = i.options.getInteger('번호');
            const candidate = i.options.getString('후보');
            const election = s.elections[id];

            if (!election || election.ended) {
                return i.reply({
                    content: '진행 중인 선거가 없습니다.',
                    ephemeral: true
                });
            }

            if (!election.candidates.includes(candidate)) {
                return i.reply({
                    content: '등록된 후보 이름을 정확히 입력해 주세요.',
                    ephemeral: true
                });
            }

            if (election.votes[i.user.id]) {
                return i.reply({
                    content: '이미 투표했습니다. 재투표할 수 없습니다.',
                    ephemeral: true
                });
            }

            election.votes[i.user.id] = candidate;

            save();

            return i.reply({
                content: `🗳️ ${candidate} 후보에게 투표했습니다.`,
                ephemeral: true
            });
        }

        // 선거 종료
        if (name === '선거종료') {
            if (!admin(i)) {
                return i.reply({
                    content: '관리자만 선거를 종료할 수 있습니다.',
                    ephemeral: true
                });
            }

            const id = i.options.getInteger('번호');
            const election = s.elections[id];

            if (!election || election.ended) {
                return i.reply({
                    content: '진행 중인 선거가 없습니다.',
                    ephemeral: true
                });
            }

            election.ended = true;

            const counts = {};

            for (const candidate of election.candidates) {
                counts[candidate] = 0;
            }

            for (const vote of Object.values(election.votes)) {
                counts[vote]++;
            }

            const results = Object.entries(counts)
                .sort((a, b) => b[1] - a[1]);

            save();

            await logAction(s, `🗳️ 선거 종료: ${election.title}`);

            return i.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🏆 선거 결과: ${election.title}`)
                        .setDescription(
                            results.map(([candidate, count], idx) =>
                                `${idx + 1}위 **${candidate}** — ${count}표`
                            ).join('\n')
                        )
                        .setColor(0x9b59b6)
                ]
            });
        }

    } catch (error) {
        console.error(`/${name} 처리 오류`, error);

        if (!i.replied && !i.deferred) {
            await i.reply({
                content: '오류가 발생했습니다. 호스팅 로그를 확인해 주세요.',
                ephemeral: true
            }).catch(console.error);
        }
    }
});

// ========================================
// 5. 자동 주가 변동
// ========================================

setInterval(() => {
    try {
        for (const s of Object.values(db)) {
            if (!s.stockEnabled) continue;

            for (const company of Object.values(s.companies)) {
                const change = (Math.random() * 0.10) - 0.05;

                company.stockPrice = Math.max(
                    1,
                    Math.round(company.stockPrice * (1 + change))
                );
            }
        }

        save();

        console.log('자동 주가 갱신 완료');
    } catch (error) {
        console.error('주가 갱신 오류:', error);
    }
}, 60 * 60 * 1000);

// ========================================
// 6. 자동 적금 만기 처리
// ========================================

setInterval(() => {
    try {
        const now = Date.now();

        for (const s of Object.values(db)) {
            for (const [id, u] of Object.entries(s.users)) {
                const remaining = [];

                for (const saving of u.savings) {
                    if (saving.dueAt <= now) {
                        const interest = Math.floor(
                            saving.principal * saving.rate
                        );

                        const tax = Math.floor(
                            interest * s.tax / 100
                        );

                        u.money += saving.principal + interest - tax;
                    } else {
                        remaining.push(saving);
                    }
                }

                u.savings = remaining;
            }
        }

        save();
    } catch (error) {
        console.error('적금 만기 처리 오류:', error);
    }
}, 60 * 1000);

// ========================================
// 7. 자동 대출 연체 회수
// ========================================

setInterval(() => {
    try {
        const now = Date.now();

        for (const s of Object.values(db)) {
            for (const u of Object.values(s.users)) {
                const remaining = [];

                for (const loan of u.loans) {
                    if (loan.dueAt <= now) {
                        const recovered = Math.min(
                            u.money,
                            loan.debt
                        );

                        u.money -= recovered;

                        const outstanding = loan.debt - recovered;

                        if (outstanding > 0) {
                            loan.debt = outstanding;
                            loan.dueAt = now + 86400000;
                            remaining.push(loan);
                        }
                    } else {
                        remaining.push(loan);
                    }
                }

                u.loans = remaining;
            }
        }

        save();
    } catch (error) {
        console.error('대출 회수 오류:', error);
    }
}, 60 * 1000);

// ========================================
// 8. 실행
// ========================================

start().catch(error => {
    console.error('봇 실행 실패:', error);
    process.exit(1);
});
