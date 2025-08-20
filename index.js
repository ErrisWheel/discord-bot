require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.BOT_TOKEN;
const DEFAULT_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID?.trim();
const ANNOUNCER_ROLE_ID = process.env.ANNOUNCER_ROLE_ID?.trim();
const ANNOUNCE_ALLOWLIST = (process.env.ANNOUNCE_ALLOWLIST || '')
    .split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN) {
    console.error('BOT_TOKEN not found in .env.');
    process.exit(1);
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.content.startsWith('!announce')) return;

        const isOwner = message.member.id === message.guild.ownerId;
        const hasManage = message.member.permissions.has(PermissionsBitField.Flags.ManageMessages);
        const hasAnnouncerRole = ANNOUNCER_ROLE_ID && message.member.roles.cache.has(ANNOUNCER_ROLE_ID);
        const isAllowlisted = ANNOUNCE_ALLOWLIST.includes(message.member.id);

        if (!hasManage && !isOwner && !hasAnnouncerRole && !isAllowlisted) {
            return message.reply("You don't have permission to use this command.");
        }

        const args = message.content.split(/\s+/).slice(1);
        const hasAttachments = message.attachments && message.attachments.size > 0;
        if (args.length === 0 && !hasAttachments) {
            return message.reply('Usage: `!announce [#channel] <message>` (you can also attach files/images)');
        }

        const first = args[0] ?? '';
        const match = first.match(/^<#(\d+)>$/);
        let targetChannel = null;
        let content = '';

        if (match) {
            const channelId = match[1];
            targetChannel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
            content = args.slice(1).join(' ');
        } else {
            content = args.join(' ');
            if (DEFAULT_CHANNEL_ID) {
                targetChannel = message.guild.channels.cache.get(DEFAULT_CHANNEL_ID) || await message.guild.channels.fetch(DEFAULT_CHANNEL_ID).catch(() => null);
            } else {
            targetChannel = message.guild.channels.cache.find(ch =>
                    ['announcements', 'announcement'].includes(ch.name?.toLowerCase())
                );
            }
        }

        if (!targetChannel) {
            return message.reply('Target channel not found. Use a channel mention or set ANNOUNCE_CHANNEL_ID in .env.');
        }

        const me = await message.guild.members.fetch(client.user.id);
        const botPerms = targetChannel.permissionsFor(me);
        if (!botPerms || !botPerms.has(PermissionsBitField.Flags.SendMessages)) {
            return message.reply("I can't send messages to the target channel (missing Send Messages permission).");
        }

        const files = [];
        const MAX_BASIC_UPLOAD = 8 * 1024 * 1024;
        if (hasAttachments) {
            for (const att of message.attachments.values()) {
                if (att.size > MAX_BASIC_UPLOAD) {
                    return message.reply(`Attachment "${att.name}" is too large (>8MB). Please use smaller files or host externally.`);
                }
                files.push(att.url);
            }

            if (files.length > 0 && !botPerms.has(PermissionsBitField.Flags.AttachFiles)) {
                return message.reply("I don't have permission to attach files in the target channel (Attach Files missing).");
            }
        }

        const wantsEveryone = /@everyone|@here/.test(content);
        const wantsRoleMention = /<@&\d+>/.test(content);

        if ((wantsEveryone || wantsRoleMention) && !botPerms.has(PermissionsBitField.Flags.MentionEveryone)) {
            return message.reply("I don't have permission to mention everyone/roles in that channel.");
        }

        const allowedMentions = { parse: ['users'] };
        if (botPerms.has(PermissionsBitField.Flags.MentionEveryone)) {
            allowedMentions.parse.push('roles', 'everyone');
        }

        const sendPayload = {
            content: content || (files.length ? '' : '(empty announcement)'),
            files: files.length ? files : undefined,
            allowedMentions
        };

        const sent = await targetChannel.send(sendPayload);

        if (targetChannel.type === ChannelType.GuildAnnouncement) {
            try {
                await sent.crosspost();
                await message.reply('Announcement sent and published.');
            } catch (err) {
                console.error('Crosspost error:', err);
                await message.reply('Announcement sent, but failed to publish (missing publish permission?).');
            }
        } else {
            await message.reply('Announcement sent.');
        }

    } catch (err) {
        console.error('Announcement error:', err);
        try { await message.reply('Something went wrong while sending the announcement.'); } catch (_) {}
    }
});

client.login(TOKEN);