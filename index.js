require('dotenv').config();
const { Client, IntentsBitField, ActivityType } = require('discord.js');
const Database = require('./database');
const config = require('./config');
const { handleSellCommand } = require('./commands/sell');
const { handleBidCommand } = require('./commands/bid');
const { handleDeleteCommand } = require('./commands/delete');
const { handleListingsCommand } = require('./commands/listings');
const { handleVerifyCommand } = require('./commands/verify');
const { handleButtonInteraction } = require('./handlers/buttonHandler');
const { handleModalSubmit } = require('./handlers/modalHandler');
const EmbedUtils = require('./utils/embedBuilder');

// Создаем клиента Discord
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
  ],
});

// Инициализируем базу данных
const db = new Database();

// Идентификатор владельца бота
const OWNER_ID = '448141002692231208';

// Идентификатор роли верифицированного продавца
const VERIFIED_SELLER_ROLE_ID = '1399007658559668275';

// Событие готовности бота
client.on('ready', () => {
  console.log(`🤖 Бот ${client.user.tag} готов к работе!`);
  console.log(`📊 Подключен к ${client.guilds.cache.size} серверам`);

  // Устанавливаем статус
  client.user.setActivity('Vegas+ Market', { type: ActivityType.Watching });

  console.log('🚀 Vegas+ Market бот запущен и готов к использованию!');
});

// Команда /ban для модераторов
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('/ban') || message.author.id !== OWNER_ID) return;

  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    return message.reply('❌ Укажите пользователя: `/ban @username <причина>`');
  }

  const reason = message.content.split(' ').slice(2).join(' ') || 'Нарушение правил маркетплейса';

  // Удаляем все объявления пользователя
  db.db.run('DELETE FROM listings WHERE user_id = ?', [targetUser.id], (err) => {
    if (err) console.error(err);
  });

  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setTitle('🔨 Пользователь заблокирован')
    .setDescription(`${targetUser.username} больше не может продавать на маркетплейсе.`)
    .addFields(
      { name: 'Причина', value: reason },
      { name: 'Модератор', value: message.author.username }
    )
    .setColor(0xe74c3c)
    .setTimestamp();

  message.reply({ embeds: [embed] });

  // Уведомление пользователя
  targetUser.send({ 
    embeds: [embed.setTitle('🚫 Вы были заблокированы на Vegas+ Market')] 
  }).catch(console.error);
});

// Команда /start_auction для создания аукционов
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('/start_auction') || message.author.bot) return;

  const args = message.content.split(' ');
  if (args.length < 5) {
    const { EmbedBuilder } = require('discord.js');
    const helpEmbed = new EmbedBuilder()
      .setTitle('❓ Помощь по команде /start_auction')
      .setDescription('Используйте: `/start_auction <категория> <начальная цена> <шаг ставки> <описание> [URL фото]`')
      .addFields(
        { name: 'Пример', value: '`/start_auction electronics 500$ 50$ Новый iPhone 15`' },
        { name: 'Категории', value: 'electronics, clothing, services, real-estate, vehicles, other' }
      )
      .setColor(0x3498db);
    return message.reply({ embeds: [helpEmbed] });
  }

  const category = args[1].toLowerCase();
  const startPrice = args[2];
  const bidStep = args[3];
  const description = args.slice(4).join(' ');
  const imageUrl = message.attachments.first()?.url || args.find(arg => arg.startsWith('http'));

  const isVerified = message.member.roles.cache.has(VERIFIED_SELLER_ROLE_ID);

  db.db.run(
    'INSERT INTO listings (user_id, category, title, description, price, image_url, date, is_auction, highest_bid, is_verified, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
    [message.author.id, category, `Аукцион от ${message.author.username}`, description, startPrice, imageUrl, new Date().toISOString(), startPrice, isVerified ? 1 : 0, 'active'],
    function (err) {
      if (err) {
        console.error(err);
        return message.reply('❌ Ошибка при создании аукциона.');
      }

      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🎪 Аукцион: ${config.categories[category]} | Начальная цена: ${startPrice}`)
        .setDescription(description)
        .addFields(
          { name: 'Шаг ставки', value: bidStep, inline: true },
          { name: 'Текущая ставка', value: startPrice, inline: true },
          { name: 'Завершится через', value: '24 часа', inline: true }
        )
        .setColor(0xf39c12)
        .setImage(imageUrl || null)
        .setFooter({ 
          text: `Продавец: ${message.author.username}`, 
          iconURL: message.author.displayAvatarURL() 
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bid_${this.lastID}`)
          .setLabel('Сделать ставку')
          .setEmoji(config.emojis.bid)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`details_${this.lastID}`)
          .setLabel('Подробнее')
          .setEmoji('ℹ️')
          .setStyle(ButtonStyle.Secondary)
      );

      message.reply({ embeds: [embed], components: [row] });

      // Завершение аукциона через 24 часа
      const auctionId = this.lastID;
      setTimeout(() => {
        db.getListing(auctionId, (err, auction) => {
          if (auction && auction.highest_bidder) {
            const winnerEmbed = new EmbedBuilder()
              .setTitle('🏆 Аукцион завершен!')
              .setDescription(`Победитель: <@${auction.highest_bidder}> со ставкой ${auction.highest_bid}`)
              .setColor(0x2ecc71);

            message.channel.send({ embeds: [winnerEmbed] });
          }
        });
      }, 86400000); // 24 часа
    }
  );
});

// Обработчики слэш-команд
async function handleSlashSellCommand(interaction, db, client) {
  const category = interaction.options.getString('category');
  const price = interaction.options.getString('price');
  const description = interaction.options.getString('description');
  const imageUrl = interaction.options.getString('image');
  const isAuction = interaction.options.getBoolean('auction') || false;

  const isVerified = interaction.member.roles.cache.has(VERIFIED_SELLER_ROLE_ID);

  db.getUserStats(interaction.user.id, (err, userStats) => {
    if (err) {
      console.error('Ошибка получения статистики пользователя:', err);
      return interaction.reply({ content: '❌ Ошибка при получении данных пользователя.', flags: 64 });
    }

    const listingData = {
      userId: interaction.user.id,
      category,
      title: `${config.categories[category]} от ${interaction.user.username}`,
      description,
      price,
      imageUrl,
      isAuction,
      isVerified
    };

    db.createListing(listingData, function(err) {
      if (err) {
        console.error('Ошибка создания объявления:', err);
        return interaction.reply({ content: '❌ Ошибка при создании объявления.', flags: 64 });
      }

      const listingId = this.lastID;

      const listing = {
        id: listingId,
        ...listingData,
        views: 0,
        highest_bid: 0,
        highest_bidder: null,
        date: new Date().toISOString(),
        is_verified: isVerified ? 1 : 0,
        is_auction: isAuction ? 1 : 0
      };

      const embed = EmbedUtils.createListingEmbed(listing, userStats, interaction.user);

      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`buy_${listingId}`)
          .setLabel('Купить')
          .setEmoji(config.emojis.buy)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`report_${listingId}`)
          .setLabel('Жалоба')
          .setEmoji(config.emojis.report)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`details_${listingId}`)
          .setLabel('Подробнее')
          .setEmoji(config.emojis.info)
          .setStyle(ButtonStyle.Primary)
      );

      if (isAuction) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`bid_${listingId}`)
            .setLabel('Сделать ставку')
            .setEmoji(config.emojis.bid)
            .setStyle(ButtonStyle.Secondary)
        );
      }

      interaction.reply({ embeds: [embed], components: [row] });

      // Логирование в админский канал
      const logChannel = client.channels.cache.get(config.logChannelId);
      if (logChannel) {
        const logEmbed = EmbedUtils.createListingEmbed(listing, userStats, interaction.user)
          .setTitle(`📢 Новое объявление (${config.categories[category]})`);

        // Находим роль admin по имени
        const adminRole = logChannel.guild.roles.cache.find(role => role.name === config.adminRole);
        const roleId = adminRole ? adminRole.id : null;

        logChannel.send({
          embeds: [logEmbed],
          content: roleId ? `Модератор, проверьте: <@&${roleId}>` : 'Модераторы, проверьте новое объявление'
        });
      }
    });
  });
}

async function handleSlashBidCommand(interaction, db, client) {
  const listingId = interaction.options.getInteger('id');
  const bidAmount = interaction.options.getInteger('amount');

  db.getListing(listingId, (err, listing) => {
    if (err || !listing) {
      return interaction.reply({ content: '❌ Объявление не найдено.', flags: 64 });
    }

    if (!listing.is_auction) {
      return interaction.reply({ content: '❌ Данное объявление не является аукционом.', flags: 64 });
    }

    if (listing.user_id === interaction.user.id) {
      return interaction.reply({ content: '❌ Вы не можете делать ставки на свои объявления.', flags: 64 });
    }

    if (bidAmount <= listing.highest_bid) {
      return interaction.reply({ content: `❌ Ваша ставка должна быть выше текущей (${listing.highest_bid})!`, flags: 64 });
    }

    db.updateBid(listingId, bidAmount, interaction.user.id, (err) => {
      if (err) {
        console.error('Ошибка обновления ставки:', err);
        return interaction.reply({ content: '❌ Ошибка при обновлении ставки.', flags: 64 });
      }

      const successEmbed = EmbedUtils.createSuccessEmbed(
        '✅ Ставка принята!',
        `Вы сделали ставку **${bidAmount}$** на лот #${listingId}`
      );

      interaction.reply({ embeds: [successEmbed], flags: 64 });

      // Уведомления и логирование (аналогично оригинальному коду)
    });
  });
}

async function handleSlashSearchCommand(interaction, db, client) {
  const category = interaction.options.getString('category') || 'all';

  db.searchListings(category === 'all' ? null : category, 5, async (err, listings) => {
    if (err) {
      console.error('Ошибка поиска:', err);
      return interaction.reply({ content: '❌ Ошибка при поиске объявлений.', flags: 64 });
    }

    if (!listings || listings.length === 0) {
      const embed = EmbedUtils.createInfoEmbed(
        '🔍 Результаты поиска',
        'Объявления не найдены.'
      );
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const embed = EmbedUtils.createInfoEmbed(
      '🔍 Результаты поиска',
      `Найдено ${listings.length} объявлений`
    );

    for (const listing of listings) {
      const seller = await client.users.fetch(listing.user_id).catch(() => null);
      if (seller) {
        embed.addFields({
          name: `#${listing.id} - ${config.categories[listing.category]} ${listing.price}`,
          value: `**${listing.title}**\n${listing.description.substring(0, 100)}...\nПродавец: ${seller.username}`,
          inline: false
        });
      }
    }

    interaction.reply({ embeds: [embed], flags: 64 });
  });
}

async function handleSlashStatsCommand(interaction, db, client) {
  const targetUser = interaction.options.getUser('user') || interaction.user;

  db.getUserStats(targetUser.id, (err, stats) => {
    if (err) {
      console.error('Ошибка получения статистики:', err);
      return interaction.reply({ content: '❌ Ошибка при получении статистики.', flags: 64 });
    }

    const embed = EmbedUtils.createUserStatsEmbed(targetUser, stats);
    interaction.reply({ embeds: [embed], flags: 64 });
  });
}

async function handleSlashListingsCommand(interaction, db, client) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const limit = interaction.options.getInteger('limit') || 5;

  const query = `
    SELECT * FROM listings 
    WHERE user_id = ? AND status = 'active'
    ORDER BY date DESC 
    LIMIT ?
  `;

  db.db.all(query, [targetUser.id, Math.min(limit, 10)], async (err, listings) => {
    if (err) {
      console.error('Ошибка получения объявлений:', err);
      return interaction.reply({ content: '❌ Ошибка при получении объявлений.', flags: 64 });
    }

    if (!listings || listings.length === 0) {
      const embed = EmbedUtils.createInfoEmbed(
        '📋 Объявления пользователя',
        `У ${targetUser.username} нет активных объявлений`
      );
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    db.getUserStats(targetUser.id, async (err, userStats) => {
      const embed = EmbedUtils.createInfoEmbed(
        `📋 Объявления пользователя ${targetUser.username}`,
        `Найдено ${listings.length} активных объявлений`
      )
      .setThumbnail(targetUser.displayAvatarURL());

      for (const listing of listings.slice(0, 5)) {
        const categoryIcon = config.categories[listing.category] || '📦';
        const auctionText = listing.is_auction ? '🔨 Аукцион' : '';
        const verifiedText = listing.is_verified ? '✅' : '';

        embed.addFields({
          name: `${verifiedText} #${listing.id} - ${categoryIcon} ${listing.price} ${auctionText}`,
          value: `${listing.description.substring(0, 80)}...\n👀 Просмотры: ${listing.views}`,
          inline: false
        });
      }

      interaction.reply({ embeds: [embed], flags: 64 });
    });
  });
}

async function handleSlashDeleteCommand(interaction, db, client) {
  const listingId = interaction.options.getInteger('id');

  db.getListing(listingId, (err, listing) => {
    if (err || !listing) {
      return interaction.reply({ content: '❌ Объявление не найдено.', flags: 64 });
    }

    const isOwner = listing.user_id === interaction.user.id;
    const isAdmin = interaction.member.roles.cache.some(role => role.name === config.adminRole);

    if (!isOwner && !isAdmin) {
      return interaction.reply({ content: '❌ Вы можете удалять только свои объявления.', flags: 64 });
    }

    db.db.run('UPDATE listings SET status = ? WHERE id = ?', ['deleted', listingId], function(err) {
      if (err) {
        console.error('Ошибка удаления объявления:', err);
        return interaction.reply({ content: '❌ Ошибка при удалении объявления.', flags: 64 });
      }

      const embed = EmbedUtils.createSuccessEmbed(
        '✅ Объявление удалено',
        `Объявление #${listingId} было успешно удалено`
      );

      interaction.reply({ embeds: [embed], flags: 64 });
    });
  });
}

async function handleSlashVerifyCommand(interaction, db, client) {
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: '❌ Блокировка пользователей , и удаление объявлений только через Тех.Поддержку.', flags: 64 });
  }

  const targetUser = interaction.options.getUser('user');
  const action = interaction.options.getString('action');

  try {
    const member = await interaction.guild.members.fetch(targetUser.id);
    const verifiedRole = interaction.guild.roles.cache.get(VERIFIED_SELLER_ROLE_ID);

    if (!verifiedRole) {
      return interaction.reply({ content: `❌ Роль верифицированного продавца не найдена на сервере.`, flags: 64 });
    }

    if (action === 'add') {
      await member.roles.add(verifiedRole);
      db.db.run('UPDATE listings SET is_verified = 1 WHERE user_id = ? AND status = "active"', [targetUser.id]);

      const embed = EmbedUtils.createSuccessEmbed(
        '✅ Пользователь верифицирован',
        `${targetUser.username} получил статус проверенного продавца`
      );
      interaction.reply({ embeds: [embed], flags: 64 });
    } else {
      await member.roles.remove(verifiedRole);
      db.db.run('UPDATE listings SET is_verified = 0 WHERE user_id = ? AND status = "active"', [targetUser.id]);

      const embed = EmbedUtils.createInfoEmbed(
        '📢 Статус верификации отозван',
        `У ${targetUser.username} отозван статус проверенного продавца`
      );
      interaction.reply({ embeds: [embed], flags: 64 });
    }
  } catch (error) {
    console.error('Ошибка верификации:', error);
    interaction.reply({ content: '❌ Ошибка при изменении статуса верификации.', flags: 64 });
  }
}

async function handleSlashHelpCommand(interaction) {
  const embed = EmbedUtils.createInfoEmbed(
    '📚 Помощь по Vegas+ Market',
    'Доступные слэш-команды:'
  )
  .addFields(
    { name: '/sell', value: 'Создать объявление о продаже', inline: false },
    { name: '/bid', value: 'Сделать ставку в аукционе', inline: false },
    { name: '/search', value: 'Поиск объявлений по категориям', inline: false },
    { name: '/stats', value: 'Показать статистику пользователя', inline: false },
    { name: '/listings', value: 'Показать объявления пользователя', inline: false },
    { name: '/delete', value: 'Удалить объявление (Тех.Поддержка)', inline: false },
    { name: '/verify', value: 'Верифицировать продавца (Тех.Поддержка)', inline: false },
    { name: '/help', value: 'Показать это сообщение', inline: false }
  )
  .addFields(
    { name: 'Категории товаров', value: Object.entries(config.categories).map(([key, val]) => `• ${val}`).join('\n'), inline: false }
  );

  interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleSlashBanCommand(interaction, db, client) {
  // Проверяем права владельца
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: '❌ Блокировка пользователей , и удаление объявлений только через Тех.Поддержку.', flags: 64 });
  }

  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Нарушение правил маркетплейса';

  // Удаляем все объявления пользователя
  db.db.run('DELETE FROM listings WHERE user_id = ?', [targetUser.id], (err) => {
    if (err) console.error(err);
  });

  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setTitle('🔨 Пользователь заблокирован')
    .setDescription(`${targetUser.username} больше не может продавать на маркетплейсе.`)
    .addFields(
      { name: 'Причина', value: reason },
      { name: 'Модератор', value: interaction.user.username }
    )
    .setColor(0xe74c3c)
    .setTimestamp();

  interaction.reply({ embeds: [embed] });

  // Уведомление пользователя
  targetUser.send({ 
    embeds: [embed.setTitle('🚫 Вы были заблокированы на Vegas+ Market')] 
  }).catch(console.error);
}

async function handleSlashStartAuctionCommand(interaction, db, client) {
  const category = interaction.options.getString('category');
  const startPrice = interaction.options.getString('start_price');
  const bidStep = interaction.options.getString('bid_step');
  const description = interaction.options.getString('description');
  const imageUrl = interaction.options.getString('image');

  const isVerified = interaction.member.roles.cache.has(VERIFIED_SELLER_ROLE_ID);

  db.db.run(
    'INSERT INTO listings (user_id, category, title, description, price, image_url, date, is_auction, highest_bid, is_verified, status, bid_step) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
    [interaction.user.id, category, `Аукцион от ${interaction.user.username}`, description, startPrice, imageUrl, new Date().toISOString(), startPrice, isVerified ? 1 : 0, 'active', bidStep],
    function (err) {
      if (err) {
        console.error(err);
        return interaction.reply({ content: '❌ Ошибка при создании аукциона.', flags: 64 });
      }

      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🎪 Аукцион: ${config.categories[category]} | Начальная цена: ${startPrice}`)
        .setDescription(description)
        .addFields(
          { name: 'Шаг ставки', value: bidStep, inline: true },
          { name: 'Текущая ставка', value: startPrice, inline: true },
          { name: 'Завершится через', value: '24 часа', inline: true }
        )
        .setColor(0xf39c12)
        .setImage(imageUrl || null)
        .setFooter({ 
          text: `Продавец: ${interaction.user.username}`, 
          iconURL: interaction.user.displayAvatarURL() 
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bid_${this.lastID}`)
          .setLabel('Сделать ставку')
          .setEmoji(config.emojis.bid)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`details_${this.lastID}`)
          .setLabel('Подробнее')
          .setEmoji('ℹ️')
          .setStyle(ButtonStyle.Secondary)
      );

      interaction.reply({ embeds: [embed], components: [row] });

      // Завершение аукциона через 24 часа
      const auctionId = this.lastID;
      setTimeout(() => {
        db.getListing(auctionId, (err, auction) => {
          if (auction && auction.highest_bidder) {
            const winnerEmbed = new EmbedBuilder()
              .setTitle('🏆 Аукцион завершен!')
              .setDescription(`Победитель: <@${auction.highest_bidder}> со ставкой ${auction.highest_bid}`)
              .setColor(0x2ecc71);

            interaction.followUp({ embeds: [winnerEmbed] });
          }
        });
      }, 86400000); // 24 часа
    }
  );
}

// Обработка всех взаимодействий
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      // Обработка слэш-команд
      switch (interaction.commandName) {
        case 'sell':
          await handleSlashSellCommand(interaction, db, client);
          break;
        case 'bid':
          await handleSlashBidCommand(interaction, db, client);
          break;
        case 'search':
          await handleSlashSearchCommand(interaction, db, client);
          break;
        case 'stats':
          await handleSlashStatsCommand(interaction, db, client);
          break;
        case 'listings':
          await handleSlashListingsCommand(interaction, db, client);
          break;
        case 'delete':
          await handleSlashDeleteCommand(interaction, db, client);
          break;
        case 'verify':
          await handleSlashVerifyCommand(interaction, db, client);
          break;
        case 'help':
          await handleSlashHelpCommand(interaction);
          break;
        case 'ban':
          await handleSlashBanCommand(interaction, db, client);
          break;
        case 'start_auction':
          await handleSlashStartAuctionCommand(interaction, db, client);
          break;
      }
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction, db, client);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction, db, client);
    }
  } catch (error) {
    console.error('Ошибка при обработке взаимодействия:', error);

    // Игнорируем ошибки с истекшими взаимодействиями
    if (error.code === 10062 || error.code === 40060) {
      console.log('Взаимодействие истекло или уже обработано, пропускаем');
      return;
    }

    const errorMessage = { 
      content: '❌ Произошла ошибка при выполнении действия.', 
      flags: 64 
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (followUpError) {
      console.log('Не удалось отправить сообщение об ошибке:', followUpError.message);
    }
  }
});

// Обработка ошибок
client.on('error', error => {
  console.error('Ошибка клиента Discord:', error);
});

process.on('unhandledRejection', error => {
  console.error('Необработанное отклонение промиса:', error);
});

process.on('uncaughtException', error => {
  console.error('Необработанное исключение:', error);
  process.exit(1);
});

// Корректное завершение работы
process.on('SIGINT', () => {
  console.log('📴 Получен сигнал SIGINT. Корректно завершаем работу...');
  db.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('📴 Получен сигнал SIGTERM. Корректно завершаем работу...');
  db.close();
  client.destroy();
  process.exit(0);
});

// Запускаем бота
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN не найден в переменных окружения!');
  process.exit(1);
}

client.login(token)
  .then(() => {
    console.log('✅ Успешно подключились к Discord API');
  })
  .catch(error => {
    console.error('❌ Ошибка при подключении к Discord:', error);
    process.exit(1);
  });

// Экспортируем для потенциального использования
module.exports = { client, db };