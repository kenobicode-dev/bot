import {conf} from './conf.js';
import crypto from 'crypto';
import { Telegraf, Markup } from 'telegraf';
import knexLib from 'knex';
import axios from 'axios';
import * as bjs from 'bitcoinjs-lib';

const knex = knexLib(conf.MySQL);
const TenMinutes = 10 * 60 * 1000;

let Status = 'Sleep';
const checkOrderChats = new Set();
const adminStates = new Map();

const Product = {
  Name: '',
  Description: '',
  Price: 0,
};

const bot = new Telegraf(conf.authToken);

bot.use((ctx, next) => {
  if (ctx.message?.chat?.id === conf.adminChatId) {
    return next();
  }

  return next();
});

bot.start(async (ctx) => {
  try {
    const name = ctx.message.from.first_name || 'пользователь';
    await ctx.reply(
      `🌐 CITIZENSVPN\n\n` +
      `Добро пожаловать, ${name}!\n` +
      `Рад приветствовать в CITIZENSVPN.\n\n` +
      `CitizensVpnBot — бот выдачи файлов конфигурации OpenVPN по коду конфигурации.\n\n` +
      `⚠️ Предупреждение\n\n` +
      `CITIZENSVPN предоставляет файлы конфигурации исключительно в технических целях.\n\n` +
      `Сервис не несёт ответственности за использование предоставленных файлов конфигурации, а также за любые последствия, возникшие в результате их применения.\n` +
      `Пользователь самостоятельно несёт полную ответственность за соблюдение законодательства страны, на территории которой используются файлы конфигурации и сервис в целом.\n` +
      `Использование файлов конфигурации должно осуществляться строго в соответствии с действующими правовыми нормами государства пребывания.\n\n` +
      `Перед использованием сервиса рекомендуем ознакомиться с законодательными актами, регулирующими применение технологий туннелирования и шифрования трафика в вашей юрисдикции.`,
      Markup.inlineKeyboard([
        Markup.button.callback('Ввести код конфигурации', 'promo'),
      ]),
    );
  } catch (e) {
    console.error('start error', e);
  }
});


bot.help(async (ctx) => {
  await ctx.reply(
    `/promo — Ввести код конфигурации`
  );
});

bot.action('promo', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const chatId = ctx.chat.id;

    adminStates.set(chatId, 'EnterPromo');

    await ctx.reply(
      '🎟 Введите код:'
    );

  } catch (err) {
    console.error('enter_promo error:', err);

    await ctx.reply(
      '❌ Не удалось открыть ввод кода.'
    );
  }
});

async function getPromoCode(code, trx = knex) {
  const normalizedCode = String(code)
    .trim()
    .toUpperCase();

  if (!normalizedCode) {
    return null;
  }

  const promo = await trx('promo_codes')
    .where({
      code: normalizedCode,
      is_active: true,
    })
    .whereRaw('used_count < max_uses')
    .where(function () {
      this.whereNull('expires_at')
        .orWhere('expires_at', '>', trx.fn.now());
    })
    .first();

  return promo || null;
}


async function getKeyByPromoCode(code) {
  const normalizedCode = String(code)
    .trim()
    .toUpperCase();

  if (!normalizedCode) {
    throw new Error('Код не указан!');
  }

  return await knex.transaction(async (trx) => {

    const promo = await trx('promo_codes')
      .where({
        code: normalizedCode,
        is_active: true,
      })
      .whereRaw('used_count < max_uses')
      .where(function () {
        this.whereNull('expires_at')
          .orWhere('expires_at', '>', trx.fn.now());
      })
      .first()
      .forUpdate();

    if (!promo) {
      throw new Error(
        'Код недействителен!'
      );
    }

    const item = await trx('my_products')
      .where({
        product_id: promo.product_id,
      })
      .first()
      .forUpdate();

    if (!item) {
      throw new Error(
        'Для этого кода закончились конфигурации'
      );
    }

    const deleted = await trx('my_products')
      .where({
        product_id: item.product_id,
        product_data: item.product_data,
      })
      .del();

    if (!deleted) {
      throw new Error(
        'Не удалось забрать конфигурацию. Попробуйте ещё раз.'
      );
    }

    const newUsedCount = Number(promo.used_count) + 1;

    await trx('promo_codes')
      .where({
        id: promo.id,
      })
      .update({
        used_count: newUsedCount,
        is_active: newUsedCount < Number(promo.max_uses),
      });

    return {
      productId: item.product_id,
      productData: item.product_data,
      promoCode: normalizedCode,
    };
  });
}

bot.command('promo', async (ctx) => {
  try {
    const args = ctx.message.text.trim().split(/\s+/);

    if (args.length < 2) {
      await ctx.reply(
        '🎟 Использование:\n\n' +
        '/promo КОД'
      );
      return;
    }

    const code = args[1];

    const result = await getKeyByPromoCode(code);

    // Формируем TXT-файл
    const fileContent = String(result.productData)
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r');

    const fileBuffer = Buffer.from(
      fileContent,
      'utf8'
    );

    await ctx.replyWithDocument(
      {
        source: fileBuffer,
        filename: `key_${result.productId}.ovpn`,
      },
      {
        caption:
          `🎟 Код активирован!\n\n` +
          `📄 Ваш файл: key_${result.productId}.ovpn`,
      }
    );

  } catch (err) {
    console.error('promo error:', err);

    await ctx.reply(
      `❌ ${err.message}`
    );
  }
});

bot.on('text', async (ctx, next) => {
  const message = ctx.message;

  if (!message || typeof message.text !== 'string') {
    return next();
  }

  const chatId = message.chat.id;
  const text = message.text;

  // код доступен ВСЕМ пользователям
  if (adminStates.get(chatId) === 'EnterPromo') {
    adminStates.set(chatId, 'Sleep');

    const code = text.trim().toUpperCase();

    if (!code) {
      await ctx.reply('❌ Код не может быть пустым.');
      return;
    }

    try {
      const result = await getKeyByPromoCode(code);

      const fileContent = String(result.productData)
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/^"|"$/g, '');

      const fileBuffer = Buffer.from(fileContent, 'utf8');

      await ctx.replyWithDocument(
        {
          source: fileBuffer,
          filename: `key_${result.productId}.ovpn`,
        },
        {
          caption:
            `🎟 Код активирован!\n\n` +
            `📄 Ваш файл: key_${result.productId}.ovpn`,
        }
      );

    } catch (err) {
      console.error('Promo error:', err);
      await ctx.reply(`❌ ${err.message}`);
    }

    return;
  }

  await handleAdminText(ctx);
  next();
});

async function handleAdminText(ctx) {
  if (!ctx.message || typeof ctx.message.text !== 'string') {
    return;
  }

  const chatId = ctx.message.chat.id;
  let currentState = adminStates.get(chatId) || 'Sleep';

  if (chatId !== conf.adminChatId) return;

  switch (currentState) {
    case 'DelProduct': {
      adminStates.set(chatId, 'Sleep');
      try {
        const rowsDeleted = await knex('my_productsinfo')
          .where({ product_id: ctx.message.text })
          .del();
        await ctx.reply(rowsDeleted > 0 ? 'Товар успешно удален.' : 'Товар не найден.');
      } catch (err) {
        console.error('DelProduct error', err);
        await ctx.reply('Во время удаления произошла ошибка.');
      }
      break;
    }
    case 'AddProduct_N': {
      adminStates.set(chatId, 'AddProduct_D');
      Product.Name = ctx.message.text;
      await ctx.reply('Укажите описание товара:');
      break;
    }
    case 'AddProduct_D': {
      adminStates.set(chatId, 'AddProduct_P');
      Product.Description = ctx.message.text;
      await ctx.reply('Укажите цену товара (в USD):');
      break;
    }
    case 'AddProduct_P': {
      adminStates.set(chatId, 'Sleep');
      const price = Number(ctx.message.text);
      if (!Number.isFinite(price)) {
        await ctx.reply('Цена должна быть числом. Попробуйте заново: начните с /addproduct.');
        return;
      }
      Product.Price = price;
      try {
        await knex('my_productsinfo').insert({
          name: Product.Name,
          description: Product.Description,
          price: Product.Price
        });
        await ctx.reply('Товар успешно добавлен.');
      } catch (err) {
        console.error('AddProduct_P error', err);
        await ctx.reply('Во время добавления товара произошла ошибка.');
      }
      break;
    }
    case 'AddProductData': {
      adminStates.set(chatId, 'Sleep');

      const parts = ctx.message.text.split('$');

      if (parts.length !== 2) {
        await ctx.reply(
          '❌ Неверный формат.\n\n' +
          'Используйте:\n' +
          'ProductData$Количество\n\n' +
          'Например:\n' +
          'client.ovpn$10'
        );
        return;
      }

      const productData = parts[0].trim();
      const count = Number(parts[1].trim());

      if (!productData) {
        await ctx.reply('❌ ProductData не может быть пустым.');
        return;
      }

      if (!Number.isInteger(count) || count < 1 || count > 10000) {
        await ctx.reply(
          '❌ Количество должно быть целым числом от 1 до 10000.'
        );
        return;
      }

      try {
        const result = await knex.transaction(async (trx) => {

          // Получаем максимальный product_id
          const maxRow = await trx('my_products')
            .max('product_id as maxProductId')
            .first();

          let nextProductId = Number(maxRow?.maxProductId) || 0;

          const products = [];
          const promos = [];

          for (let i = 0; i < count; i++) {
            nextProductId++;

            // Генерируем уникальный код
            let promoCode;
            let exists = true;

            while (exists) {
              promoCode =
                'CVPN-' +
                crypto.randomBytes(5)
                  .toString('hex')
                  .toUpperCase();

              const existing = await trx('promo_codes')
                .where({ code: promoCode })
                .first();

              exists = !!existing;
            }

            products.push({
              product_id: nextProductId,
              product_data: productData
            });

            promos.push({
              code: promoCode,
              product_id: nextProductId,
              max_uses: 1,
              used_count: 0,
              expires_at: null,
              is_active: true
            });
          }

          // Сначала создаём продукты
          await trx('my_products').insert(products);

          // Затем коды
          await trx('promo_codes').insert(promos);

          return {
            products,
            promos
          };
        });

        let message =
          `✅ Успешно создано: ${result.products.length} продуктов\n\n` +
          `🔑 Общая конфигурация:\n${productData}\n\n` +
          `🎟 КОДЫ:\n\n`;

        for (let i = 0; i < result.products.length; i++) {
          const product = result.products[i];
          const promo = result.promos[i];

          message +=
            `━━━━━━━━━━━━━━\n` +
            `📄 Product ID: ${product.product_id}\n` +
            `🎟 Код: ${promo.code}\n`;
        }

        await ctx.reply(message);

      } catch (err) {
        console.error('AddProductData transaction error:', err);

        await ctx.reply(
          '❌ Не удалось создать продукты и коды.\n' +
          'Все изменения были отменены.'
        );
      }

      break;
    }
    case 'DelProductData': {
      adminStates.set(chatId, 'Sleep');
      const parts = ctx.message.text.split('$');
      if (parts.length !== 2) {
        await ctx.reply('Формат: ID$ProductData');
        return;
      }
      const [productId, productData] = parts;
      try {
        const rowsDeleted = await knex('my_products')
          .where({ product_id: productId, product_data: productData })
          .del();
        await ctx.reply(rowsDeleted > 0 ? 'Продукт успешно удален.' : 'Продукт не найден.');
      } catch (err) {
        console.error('DelProductData error', err);
        await ctx.reply('Во время удаления произошла ошибка.');
      }
      break;
    }
    case 'AddPromo': {
      adminStates.set(chatId, 'Sleep');

      const parts = ctx.message.text
        .split('$')
        .map(x => x.trim());

      if (parts.length < 3 || parts.length > 4) {
        await ctx.reply(
          '❌ Неверный формат.\n\n' +
          'Используйте:\n' +
          'CODE$PRODUCT_ID$MAX_USES$EXPIRES_AT'
        );
        return;
      }

      const code = parts[0].toUpperCase();
      const productId = parts[1];
      const maxUses = Number(parts[2]);
      const expiresAt = parts[3] || null;

      if (!code) {
        await ctx.reply('❌ код не может быть пустым.');
        return;
      }

      if (!Number.isInteger(maxUses) || maxUses < 1) {
        await ctx.reply(
          '❌ MAX_USES должен быть целым числом больше 0.'
        );
        return;
      }

      try {
        const product = await knex('my_products')
          .where({
            product_id: productId,
          })
          .first();

        if (!product) {
          await ctx.reply(
            `❌ Для product_id ${productId} нет доступных конфигураций в my_products.`
          );
          return;
        }

        const [existingPromo] = await knex('promo_codes')
          .where({
            code,
          });

        if (existingPromo) {
          await ctx.reply(
            '❌ Такой код уже существует.'
          );
          return;
        }

        await knex('promo_codes').insert({
          code,
          product_id: productId,
          max_uses: maxUses,
          used_count: 0,
          expires_at: expiresAt,
          is_active: true,
        });


        await ctx.reply(
          `✅ Код создан!\n\n` +
          `🎟 Код: ${code}\n` +
          `📄 Product ID: ${productId}\n` +
          `🔢 Активаций: ${maxUses}\n` +
          `⏰ До: ${expiresAt || 'без ограничения'}`
        );

      } catch (err) {
        console.error('AddPromo error:', err);

        await ctx.reply(
          '❌ Ошибка при создании кода.'
        );
      }

      break;
    }
  }
}

bot.command('cancel', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'Sleep');
  await ctx.reply('Все текущие операции были отменены.');
});

bot.command('addproduct', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'AddProduct_N');
  await ctx.reply('Укажите название товара:');
});

bot.command('addproductdata', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }

  adminStates.set(ctx.message.chat.id, 'AddProductData');

  await ctx.reply(
    '📄 Добавление продуктов и кодов\n\n' +
    'Формат:\n' +
    'ProductData$Количество\n\n' +
    'Пример:\n' +
    'client.ovpn$10\n\n' +
    'Будет создано 10 продуктов:\n' +
    '• у каждого свой Product ID\n' +
    '• у каждого свой код\n' +
    '• конфигурация у всех одинаковая\n' +
    '• каждый код используется 1 раз'
  );
});

// bot.command('showproductdata', async (ctx) => {
//   try {
//     if (ctx.message.chat.id !== conf.adminChatId) {
//       return;
//     }
//     const rows = await knex('my_products').select();
//     if (rows.length === 0) {
//       await ctx.reply('Нет данных о продуктах.');
//       return;
//     }

//     await ctx.reply(JSON.stringify(rows, null, 2));
//   } catch (err) {
//     console.error('showproductdata error', err);
//     await ctx.reply('Произошла ошибка.');
//   }
// });

// bot.command('showproductdata', async (ctx) => {
//   try {
//     if (ctx.message.chat.id !== conf.adminChatId) {
//       return;
//     }

//     const rows = await knex('my_products')
//       .select('id', 'product_id');

//     if (rows.length === 0) {
//       await ctx.reply('Нет данных о продуктах.');
//       return;
//     }

//     await ctx.reply(
//       `📄 Всего ключей: ${rows.length}\n\n` +
//       rows.map(row => `ID: ${row.id} | Product ID: ${row.product_id}`).join('\n')
//     );

//   } catch (err) {
//     console.error('showproductdata error:', err);
//     await ctx.reply('Произошла ошибка.');
//   }
// });

bot.command('showproductdata', async (ctx) => {
  try {
    if (ctx.message.chat.id !== conf.adminChatId) {
      return;
    }

    const rows = await knex('my_products').select();

    if (rows.length === 0) {
      await ctx.reply('Нет данных о продуктах.');
      return;
    }

    const content = rows
      .map(row =>
        `ID: ${row.id}\n` +
        `Product ID: ${row.product_id}\n` +
        `Product Data:\n${row.product_data}\n` +
        `${'='.repeat(50)}\n`
      )
      .join('\n');

    const buffer = Buffer.from(content, 'utf8');

    await ctx.replyWithDocument(
      {
        source: buffer,
        filename: 'product_data.txt',
      },
      {
        caption: `📄 Всего конфигураций: ${rows.length}`,
      }
    );

  } catch (err) {
    console.error('showproductdata error:', err);
    await ctx.reply('Произошла ошибка.');
  }
});

bot.command('delproductdata', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'DelProductData');
  await ctx.reply('Отправьте данные о продукте для удаления в формате: ID$ProductData');
});

bot.command('delproduct', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'DelProduct');
  await ctx.reply('Отправьте ID продукта, который хотите удалить:');
});

bot.command('addpromo', async (ctx) => {
  const chatId = ctx.message.chat.id;
  if (chatId !== conf.adminChatId) {
    return;
  }

  adminStates.set(chatId, 'AddPromo');

  await ctx.reply(
    '🎟 Создание кода\n\n' +
    'Отправьте:\n\n' +
    'CODE$PRODUCT_ID$MAX_USES$EXPIRES_AT\n\n' +
    'Например:\n' +
    'FREE-12345$3$1$2026-12-31 23:59:59\n\n' +
    'Без срока:\n' +
    'FREE-12345$3$1'
  );
});

bot.command('showpromos', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }

  try {
    const promos = await knex('promo_codes')
      .orderBy('id', 'desc');

    if (promos.length === 0) {
      await ctx.reply(
        '🎟 Кодов пока нет.'
      );
      return;
    }

    let message = '🎟 КОДЫ\n\n';

    for (const promo of promos) {
      message +=
        `━━━━━━━━━━━━━━\n` +
        `🎟 ${promo.code}\n` +
        `📄 Product ID: ${promo.product_id}\n` +
        `🔢 Использовано: ${promo.used_count}/${promo.max_uses}\n` +
        `⏰ Истекает: ${promo.expires_at || 'нет'}\n` +
        `📌 Статус: ${promo.is_active ? 'Активен' : 'Неактивен'}\n`;
    }

    await ctx.reply(message);

  } catch (err) {
    console.error('showpromos error:', err);

    await ctx.reply(
      '❌ Ошибка при получении кодов.'
    );
  }
});

bot.command('showactivepromos', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }

  try {
    const promos = await knex('promo_codes')
      .where('is_active', true)
      .whereRaw('used_count < max_uses')
      .where(function () {
        this.whereNull('expires_at')
          .orWhere('expires_at', '>', knex.fn.now());
      })
      .orderBy('id', 'desc');

    if (promos.length === 0) {
      await ctx.reply(
        '🎟 Активных кодов нет.'
      );
      return;
    }

    let message = '🎟 АКТИВНЫЕ КОДЫ\n\n';

    for (const promo of promos) {
      message +=
        `━━━━━━━━━━━━━━\n` +
        `🎟 ${promo.code}\n` +
        `📄 Product ID: ${promo.product_id}\n` +
        `🔢 Использовано: ${promo.used_count}/${promo.max_uses}\n` +
        `⏰ Истекает: ${promo.expires_at || 'нет'}\n`;
    }

    await ctx.reply(message);

  } catch (err) {
    console.error('showpromos error:', err);

    await ctx.reply(
      '❌ Ошибка при получении активных кодов.'
    );
  }
});

bot.command('delpromo', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }

  const args = ctx.message.text
    .trim()
    .split(/\s+/);

  if (args.length < 2) {
    await ctx.reply(
      'Использование:\n\n' +
      '/delpromo CODE'
    );
    return;
  }

  const code = args[1]
    .trim()
    .toUpperCase();

  try {

    const deleted = await knex('promo_codes')
      .where({
        code,
      })
      .del();

    if (deleted === 0) {
      await ctx.reply(
        '❌ код не найден.'
      );
      return;
    }

    await ctx.reply(
      `✅ Код ${code} удалён.`
    );

  } catch (err) {
    console.error('delpromo error:', err);

    await ctx.reply(
      '❌ Ошибка при удалении кода.'
    );
  }
});

bot.command('echo', async (ctx) => {
  if (ctx.message.chat.id !== conf.adminChatId) {
    return;
  }
  await ctx.reply(`Ваш chat.id: ${ctx.message.chat.id}`);
});

bot.command('adminp13qh7', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    return;
  }

  await ctx.reply(
    '🛠 Админ-панель',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('📄 Добавить коды списком', 'admin_addproductdata'),
      ],
      [
        Markup.button.callback('🎟 Добавить код', 'admin_addpromo'),
        Markup.button.callback('🗑 Удалить код', 'admin_delpromo'),
      ],
      [
        Markup.button.callback('📋 Список кодов', 'admin_showpromos'),
        Markup.button.callback('📋 Активные коды', 'admin_showactivepromos'),
      ],
      [
        Markup.button.callback('📄 Конфигурации', 'admin_showproductdata'),
      ],
      [
        Markup.button.callback('🗑 Удалить Конфигурацию', 'admin_delproductdata'),
      ],
      [
        Markup.button.callback('❌ Отмена', 'admin_cancel'),
      ],
    ])
  );
});

bot.action('admin_addproduct', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  adminStates.set(ctx.chat.id, 'AddProduct_N');

  await ctx.reply('Укажите название товара:');
});


bot.action('admin_addproductdata', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  adminStates.set(ctx.chat.id, 'AddProductData');

  await ctx.reply(
    '📄 Добавление продуктов и кодов\n\n' +
    'Формат:\n' +
    'ProductData$Количество\n\n' +
    'Например:\n' +
    'client.ovpn$10'
  );
});


bot.action('admin_addpromo', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  adminStates.set(ctx.chat.id, 'AddPromo');

  await ctx.reply(
    '🎟 Создание кода\n\n' +
    'Формат:\n' +
    'CODE$PRODUCT_ID$MAX_USES$EXPIRES_AT\n\n' +
    'Например:\n' +
    'FREE-12345$3$2026-12-31 23:59:59'
  );
});


bot.action('admin_showpromos', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  // Можно вызвать ту же логику, что сейчас находится в /showpromos
  try {
    const promos = await knex('promo_codes')
      .orderBy('id', 'desc');

    if (promos.length === 0) {
      await ctx.reply('🎟 Кодов пока нет.');
      return;
    }

    let message = '🎟 КОДЫ\n\n';

    for (const promo of promos) {
      message +=
        `━━━━━━━━━━━━━━\n` +
        `🎟 ${promo.code}\n` +
        `📄 Product ID: ${promo.product_id}\n` +
        `🔢 Использовано: ${promo.used_count}/${promo.max_uses}\n` +
        `⏰ Истекает: ${promo.expires_at || 'нет'}\n` +
        `📌 Статус: ${promo.is_active ? 'Активен' : 'Неактивен'}\n`;
    }

    await ctx.reply(message);

  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Ошибка при получении кодов.');
  }
});


bot.action('admin_showactivepromos', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  try {
    const promos = await knex('promo_codes')
      .where('is_active', true)
      .whereRaw('used_count < max_uses')
      .where(function () {
        this.whereNull('expires_at')
          .orWhere('expires_at', '>', knex.fn.now());
      })
      .orderBy('id', 'desc');

    if (promos.length === 0) {
      await ctx.reply('🎟 Активных кодов нет.');
      return;
    }

    let message = '🎟 АКТИВНЫЕ КОДЫ\n\n';

    for (const promo of promos) {
      message +=
        `━━━━━━━━━━━━━━\n` +
        `🎟 ${promo.code}\n` +
        `📄 Product ID: ${promo.product_id}\n` +
        `🔢 Использовано: ${promo.used_count}/${promo.max_uses}\n` +
        `⏰ Истекает: ${promo.expires_at || 'нет'}\n`;
    }

    await ctx.reply(message);

  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Ошибка при получении активных кодов.');
  }
});


bot.action('admin_showproductdata', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  try {
    const rows = await knex('my_products').select();

    if (rows.length === 0) {
      await ctx.reply('Нет данных о продуктах.');
      return;
    }

    const content = rows
      .map(row =>
        `ID: ${row.id}\n` +
        `Product ID: ${row.product_id}\n` +
        `Product Data:\n${row.product_data}\n` +
        `${'='.repeat(50)}\n`
      )
      .join('\n');

    await ctx.replyWithDocument(
      {
        source: Buffer.from(content, 'utf8'),
        filename: 'product_data.txt',
      },
      {
        caption: `📄 Всего конфигураций: ${rows.length}`,
      }
    );

  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Ошибка.');
  }
});


bot.action('admin_delproductdata', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  adminStates.set(ctx.chat.id, 'DelProductData');

  await ctx.reply(
    '🗑 Отправьте данные для удаления:\n\n' +
    'ID$ProductData'
  );
});


bot.action('admin_delpromo', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  await ctx.reply(
    '🗑 Для удаления кода используйте:\n\n' +
    '/delpromo CODE'
  );
});


bot.action('admin_cancel', async (ctx) => {
  if (ctx.chat.id !== conf.adminChatId) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  await ctx.answerCbQuery();

  adminStates.set(ctx.chat.id, 'Sleep');

  await ctx.reply('❌ Все текущие операции отменены.');
});

bot.launch().then(() => {
  console.log("STARTED");
});
