
import {conf} from './conf.js';
import crypto from 'crypto';
import { Telegraf, Markup } from 'telegraf';
import knexLib from 'knex';

import axios from 'axios';
import * as bjs from 'bitcoinjs-lib';
// import { XPubGenerator } from 'xpub-generator';
// import bc_check from "./bccontrols/bc_check.js"

const knex = knexLib(conf.MySQL);

// bc_check()

const TenMinutes = 10 * 60 * 1000; // интервал проверки ордеров (мс)

let Status = 'Sleep';
const checkOrderChats = new Set(); // вместо массива — быстрее и чище

const Product = {
  Name: '',
  Description: '',
  Price: 0,
};

const bot = new Telegraf(conf.authToken);

// --- Middleware для админа ---
bot.use((ctx, next) => {
  if (ctx.message?.chat?.id === conf.adminChatId) {
    return next();
  }
  // Если не админ — просто пропускаем дальше (обычные команды работают)
  return next();
});

// --- Команды бота ---

bot.start(async (ctx) => {
  try {
    const name = ctx.message.from.first_name || 'пользователь';
    await ctx.reply(
      `🌐 CITIZENSVPN\n\n` +
      `Добро пожаловать, ${name}!\n` +
      `Рады приветствовать тебя в SITIZENSVPN.\n\n` +
      `Рады приветствовать тебя в SITIZENSVPN.\n\n` +
      `SITIZENSVPN - Свободная сеть!`,
      Markup.inlineKeyboard([
        Markup.button.callback('Ввести промокод', 'promo'),
      ]),
      // Markup.inlineKeyboard([
      //   Markup.button.callback('Просмотр всех продуктов', 'showproducts'),
      // ])
    );
  } catch (e) {
    console.error('start error', e);
  }
});

bot.help(async (ctx) => {
  await ctx.reply(
    `/promo — Ввести промокод`
    // `/showproducts — Просмотр всех продуктов\n` +
    // `/checkorder — Проверить статус заказа`
  );
});

bot.action('promo', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const chatId = ctx.chat.id;

    adminStates.set(chatId, 'EnterPromo');

    await ctx.reply(
      '🎁 Введите промокод:'
    );

  } catch (err) {
    console.error('enter_promo error:', err);

    await ctx.reply(
      '❌ Не удалось открыть ввод промокода.'
    );
  }
});

// bot.action('showproducts', async (ctx) => {
//   try {
//     const productsInfo = await knex.select().from('my_productsinfo');

//     if (productsInfo.length === 0) {
//       await ctx.reply('‼️В магазине пока нет продуктов.‼️');
//       return;
//     }

//     for (const product of productsInfo) {
//       const [{ count }] = await knex('my_products')
//         .where({ product_id: product.product_id })
//         .count({ count: '*' });

//       await ctx.reply(
//         `🌐 CITIZENSVPN\n\n` +
//         `🖊 Название: ${product.name}\n\n` +
//         `📒 Описание: ${product.description}\n\n` +
//         `1️⃣ Кол-во ключей: 1 ключ\n\n` +
//         `💲 Цена: ${product.price}$\n`,

//         Markup.inlineKeyboard([
//           Markup.button.callback('Купить', `${product.product_id}$${product.price}`),
//         ])
//       );
//     }
//   } catch (err) {
//     console.error('/showproducts error', err);
//     await ctx.reply('‼️Ошибка при получении списка продуктов.‼️');
//   }
// });

bot.action(/^check_order_(\w+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const orderId = ctx.match[1];
    const [order] = await knex('my_orders').where({ order_id: orderId });

    if (!order) {
      return await ctx.reply('‼️Заказ не найден.‼️');
    }

    // Добавляем кнопку отмены
    await ctx.reply(
      `🌐 CITIZENSVPN\n\n` +
      `📍 ID заказа: ${order.order_id}\n\n` +
      `${order.status == 'Отменен' ? '🔴' : '🟠' } Статус: ${order.status}\n\n` +
      `📂 Товар: ${order.product_data}\n\n` +
      `${order.status == 'Отменен' ? `` : `🧾 Реквизиты: ${order.address}\n\n` }` +
      `${order.status == 'Отменен' ? `` : `💲 Сумма к оплате: ${order.price} BTC\n\n`}`,
      
      Markup.inlineKeyboard([
        Markup.button.callback('❓ Проверить заказ', `check_order_${order.order_id}`, order.status == "Отменен" ? true : false),
        Markup.button.callback('❌ Отменить заказ', `cancel_order_${order.order_id}`, order.status == "Отменен" ? true : false)
      ])
    );
  } catch (err) {
    console.error('‼️Ошибка проверки заказа‼️', err);
    await ctx.reply('‼️Произошла ошибка.‼️');
  }
});

// Обработчик отмены заказа через callback
bot.action(/^cancel_order_(\w+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const orderId = ctx.match[1];

    // Проверяем существование заказа
    const [order] = await knex('my_orders').where({ order_id: orderId });

    if (!order) {
      return await ctx.reply('‼️Заказ не найден или уже обработан.‼️');
    }

    // Проверяем, можно ли отменить заказ
    if (order.status === 'Выполнен') {
      return await ctx.reply('‼️Невозможно отменить выполненный заказ.‼️');
    }

    // Отменяем заказ
    await knex('my_orders')
      .where({ order_id: orderId })
      .update({
        status: 'Отменен',
        product_data: 'Заказ отменен'
      });

    await ctx.reply('‼️Заказ успешно отменен.‼️');
  } catch (err) {
    console.error('‼️Ошибка отмены заказа‼️', err);
    await ctx.reply('‼️Произошла ошибка при отмене заказа.‼️');
  }
});
// --- Вспомогательные функции ---

async function calcPrice(priceUsd) {
  try {
    // CoinMarketCap API: лучше использовать свой API-ключ, если требуется
    const response = await axios.get(
      'https://pro-api.coinmarketcap.com/v2/tools/price-conversion',
      {
        params: {
          amount: priceUsd,
          convert_id: 1, // BTC
          id: 2781,     // USD
        },
        headers: {
          'Accepts': 'application/json',
          'X-CMC_PRO_API_KEY': conf.cmc,
        }
      }
    );

    const btcPrice = response.data.data.quote['1'].price;
    return Number(btcPrice.toFixed(8));
  } catch (err) {
    console.error('calcPrice error', err);
    throw new Error('Ошибка при расчете цены BTC');
  }
}

async function getBalance(address) {
  try {
    const response = await axios.get(`https://chain.api.btc.com/v3/address/${address}`);
    const data = response.data.data;
    const factor = 0.00000001;

    return {
      received: Number((data.received * factor).toFixed(8)),
      unconfirmed: Number((data.unconfirmed_received * factor).toFixed(8)),
    };
  } catch (err) {
    console.error('getBalance error', err);
    return { received: null, unconfirmed: null };
  }
}

function generateOrderId() {
  // Более надежный вариант, чем MD5(Date + callback_id)
  return crypto.randomBytes(16).toString('hex');
}

// --- Промокоды ---

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
    throw new Error('Промокод не указан');
  }

  return await knex.transaction(async (trx) => {

    // Получаем промокод
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
        'Промокод недействителен, истёк или уже использован'
      );
    }


    // Ищем свободный ключ
    const item = await trx('my_products')
      .where({
        product_id: promo.product_id,
      })
      .first()
      .forUpdate();

    if (!item) {
      throw new Error(
        'Для этого промокода закончились ключи'
      );
    }


    // Удаляем выданный ключ
    const deleted = await trx('my_products')
      .where({
        product_id: item.product_id,
        product_data: item.product_data,
      })
      .del();

    if (!deleted) {
      throw new Error(
        'Не удалось забрать ключ. Попробуйте ещё раз.'
      );
    }


    // Увеличиваем число использований
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
// --- Обработка callback_query (кнопка «Купить») ---

bot.on('callback_query', async (ctx) => {
  try {
    const dataParts = ctx.update.callback_query.data.split('$');
    if (dataParts.length !== 2) {
      await ctx.answerCbQuery({ text: 'Некорректные данные кнопки', show_alert: true });
      return;
    }

    const [productId, priceUsdStr] = dataParts;
    const priceUsd = Number(priceUsdStr);
    if (!Number.isFinite(priceUsd)) {
      throw new Error('Некорректная цена');
    }

    const summaBtc = await calcPrice(priceUsd);

    // Получаем все существующие BTC-адреса из БД
    const existingRows = await knex('my_orders').select('address');
    const existingAddresses = existingRows.map((r) => r.address);

    let didi = -1;
    let t_address;

    do {
      didi++;
      t_address = process.env.BCAD; // ПРИДУМАТЬ !!!
    } while (existingAddresses.includes(t_address));

    const orderId = generateOrderId();
    const now = new Date();

    const Arra = {
      order_id: orderId,
      address: t_address,
      status: 'Ожидает оплаты',
      price: summaBtc,
      product_id: productId,
      created_at: now,
      product_data: 'Будет доступно после оплаты',
    };

    await knex('my_orders').insert(Arra);

    // ИСПРАВЛЕНО: ctx.answerCbQuery() вместо ctx.answerCallbackQuery()
    await ctx.answerCbQuery();

    await ctx.reply(
      `🌐 CITIZENSVPN\n\n` +
      `🕑 Ваш заказ находится в обработке\n\n` +
      `📍 ID заказа: ${orderId}\n\n` +
      `🟠 Статус: Ожидает оплаты\n\n` +
      `‼️ Время на оплату: 90 минут\n` +
      `‼️Через 90 минут заказ будет ликвидирован\n\n` +
      `🧾 Реквизиты для оплаты BTC: ${t_address}\n\n` +
      `💲 Сумма к оплате: ${summaBtc} BTC\n\n` +
      `🔄 Вы можете проверить статус вашего заказа.`,
      Markup.inlineKeyboard([
        Markup.button.callback('❓ Проверить заказ', `check_order_${orderId}`),
        Markup.button.callback('❌ Отменить заказ', `cancel_order_${orderId}`)
      ])
    );
  } catch (err) {
    console.error('callback_query error', err);
    // Если ctx.update.callback_query существует — отвечаем через него, иначе просто логируем
    if (ctx.update && ctx.update.callback_query) {
      try {
        await ctx.answerCbQuery({ text: 'Произошла ошибка. Попробуйте позднее.', show_alert: true });
      } catch (e) {
        console.warn('Не удалось отправить answerCbQuery', e);
      }
    }
    // Дальше можно отправить обычное сообщение, если это уместно
  }
});

// --- /showproducts ---

// bot.command('showproducts', async (ctx) => {
//   try {
//     const productsInfo = await knex.select().from('my_productsinfo');

//     if (productsInfo.length === 0) {
//       await ctx.reply('В магазине пока нет продуктов.');
//       return;
//     }

//     for (const product of productsInfo) {
//       const [{ count }] = await knex('my_products')
//         .where({ product_id: product.product_id })
//         .count({ count: '*' });

//       await ctx.reply(
//         `🌐 CITIZENSVPN\n\n` +
//         `📍 ID продукта: ${product.product_id}\n` +
//         // `--\n` +
//         `🖊 Название: ${product.name}\n\n` +
//         `📒 Описание: ${product.description}\n\n` +
//         `1️⃣ Кол-во ключей: 1 ключ\n\n` +
//         `💲 Цена: ${product.price}$\n`,

//         Markup.inlineKeyboard([
//           Markup.button.callback('Купить', `${product.product_id}$${product.price}`),
//         ])
//       );
//     }
//   } catch (err) {
//     console.error('/showproducts error', err);
//     await ctx.reply('Ошибка при получении списка продуктов.');
//   }
// });

// --- /checkorder ---

// bot.command('checkorder', async (ctx) => {
//   checkOrderChats.add(ctx.message.chat.id);
//   await ctx.reply('Введите ID заказа:');
// });

// bot.command('promo', async (ctx) => {
//   try {
//     const args = ctx.message.text.trim().split(/\s+/);

//     if (args.length < 2) {
//       await ctx.reply(
//         '🎁 Использование:\n\n' +
//         '/promo ПРОМОКОД'
//       );
//       return;
//     }

//     const code = args[1];

//     const result = await getKeyByPromoCode(code);

//     await ctx.reply(
//       `🎁 Промокод успешно активирован!\n\n` +
//       `🔑 Ваш ключ:\n\n` +
//       `${result.productData}`
//     );

//   } catch (err) {
//     console.error('promo error:', err);

//     await ctx.reply(
//       `❌ ${err.message}`
//     );
//   }
// });

bot.command('promo', async (ctx) => {
  try {
    const args = ctx.message.text.trim().split(/\s+/);

    if (args.length < 2) {
      await ctx.reply(
        '🎁 Использование:\n\n' +
        '/promo ПРОМОКОД'
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
          `🎁 Промокод активирован!\n\n` +
          `📦 Ваш файл: key_${result.productId}.ovpn`,
      }
    );

  } catch (err) {
    console.error('promo error:', err);

    await ctx.reply(
      `❌ ${err.message}`
    );
  }
});

// --- Обработка текстовых сообщений (покупатели) ---

bot.on('text', async (ctx, next) => {
  const chatId = ctx.message.chat.id;

  if (checkOrderChats.has(chatId)) {
    checkOrderChats.delete(chatId);

    const orderIdInput = ctx.message.text.trim();
    if (!orderIdInput) {
      await ctx.reply('Пожалуйста, введите корректный ID заказа.');
      return;
    }

    try {
      const [order] = await knex('my_orders').where({ order_id: orderIdInput });

      if (!order) {
        await ctx.reply('Ордер не найден.');
        return;
      }

      await ctx.reply(
        `🌐 CITIZENSVPN\n\n` +
        `📍 ID заказа: ${order.order_id}\n\n` +
        `${order.status == 'Отменен' ? '🔴' : '🟠' } Статус: ${order.status}\n\n` +
        `📂 Товар: ${order.product_data}\n\n` +
        `${order.status == 'Отменен' ? `` : `🧾 Реквизиты: ${order.address}\n\n` }` +
        `${order.status == 'Отменен' ? `` : `💲 Сумма к оплате: ${order.price} BTC\n\n`}`
      );
    } catch (err) {
      console.error('checkorder error', err);
      await ctx.reply('Произошла ошибка при проверке заказа.');
    }
    return; // не вызываем next(), чтобы не мешать другим обработчикам
  }

  // Для админа: обработка статусов добавления/удаления
  await handleAdminText(ctx);
  next();
});

async function sendKeyFile(ctx, productData, productId) {
  if (productData === undefined || productData === null) {
    throw new Error('Данные ключа отсутствуют');
  }

  // В БД у тебя \n могут храниться как два символа: "\" + "n"
  const fileContent = String(productData)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');

  const buffer = Buffer.from(fileContent, 'utf8');

  await ctx.replyWithDocument(
    {
      source: buffer,
      filename: `Product_${productId}.ovpn`,
    },
    {
      caption: '🔑 Ваш ключ готов. Файл прикреплён выше.',
    }
  );
}

const adminStates = new Map();

// Обновляем функцию обработки текста
async function handleAdminText(ctx) {
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
        await ctx.reply('Формат: ID$ProductData. Например: 3$email:password');
        return;
      }
      const [productId, productData] = parts;
      try {
        await knex('my_products').insert({
          product_id: productId,
          product_data: JSON.stringify(productData)
        });
        await ctx.reply('Продукт успешно добавлен в БД.');
      } catch (err) {
        console.error('AddProductData error', err);
        await ctx.reply('Во время добавления в БД произошла ошибка.');
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
        await ctx.reply('❌ Промокод не может быть пустым.');
        return;
      }

      if (!Number.isInteger(maxUses) || maxUses < 1) {
        await ctx.reply(
          '❌ MAX_USES должен быть целым числом больше 0.'
        );
        return;
      }

      try {

        // Проверяем, существует ли товар
        const product = await knex('my_products')
          .where({
            product_id: productId,
          })
          .first();

        if (!product) {
          await ctx.reply(
            `❌ Для product_id ${productId} нет доступных ключей в my_products.`
          );
          return;
        }


        // Проверяем, нет ли такого промокода
        const [existingPromo] = await knex('promo_codes')
          .where({
            code,
          });

        if (existingPromo) {
          await ctx.reply(
            '❌ Такой промокод уже существует.'
          );
          return;
        }


        // Создаём промокод
        await knex('promo_codes').insert({
          code,
          product_id: productId,
          max_uses: maxUses,
          used_count: 0,
          expires_at: expiresAt,
          is_active: true,
        });


        await ctx.reply(
          `✅ Промокод создан!\n\n` +
          `🎟 Код: ${code}\n` +
          `📦 Product ID: ${productId}\n` +
          `🔢 Активаций: ${maxUses}\n` +
          `⏰ До: ${expiresAt || 'без ограничения'}`
        );

      } catch (err) {
        console.error('AddPromo error:', err);

        await ctx.reply(
          '❌ Ошибка при создании промокода.'
        );
      }

      break;
    }
    case 'EnterPromo': {
      adminStates.set(chatId, 'Sleep');

      const code = ctx.message.text
        .trim()
        .toUpperCase();

      if (!code) {
        await ctx.reply('❌ Промокод не может быть пустым.');
        break;
      }

      try {
        const result = await getKeyByPromoCode(code);

        await sendKeyFile(
          ctx,
          result.productData,
          result.productId
        );

      } catch (err) {
        console.error('EnterPromo error:', err);

        await ctx.reply(
          `❌ ${err.message}`
        );
      }

      break;
    }
  }
}

// --- Админ-команды ---
bot.command('cancel', async (ctx) => {
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'Sleep');
  await ctx.reply('Все текущие операции были отменены.');
});

bot.command('addproduct', async (ctx) => {
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'AddProduct_N');
  await ctx.reply('Укажите название товара:');
});

bot.command('addproductdata', async (ctx) => {
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'AddProductData');
  await ctx.reply('Отправьте данные для добавления в формате: ID$ProductData\nНапример: 3$email:password');
});

bot.command('showproductdata', async (ctx) => {
  try {
    const rows = await knex('my_products').select();
    if (rows.length === 0) {
      await ctx.reply('Нет данных о продуктах.');
      return;
    }
    // Лучше не отправлять всю таблицу одним сообщением — можно разбить
    await ctx.reply(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('showproductdata error', err);
    await ctx.reply('Произошла ошибка.');
  }
});

bot.command('delproductdata', async (ctx) => {
  const chatId = ctx.message.chat.id;
  adminStates.set(chatId, 'DelProductData');
  await ctx.reply('Отправьте данные о продукте для удаления в формате: ID$ProductData');
});

bot.command('delproduct', async (ctx) => {
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
    '🎟 Создание промокода\n\n' +
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
        '🎟 Промокодов пока нет.'
      );
      return;
    }

    let message = '🎟 ПРОМОКОДЫ\n\n';

    for (const promo of promos) {
      message +=
        `━━━━━━━━━━━━━━\n` +
        `🎟 ${promo.code}\n` +
        `📦 Product ID: ${promo.product_id}\n` +
        `🔢 Использовано: ${promo.used_count}/${promo.max_uses}\n` +
        `⏰ Истекает: ${promo.expires_at || 'нет'}\n` +
        `📌 Статус: ${promo.is_active ? 'Активен' : 'Неактивен'}\n`;
    }

    await ctx.reply(message);

  } catch (err) {
    console.error('showpromos error:', err);

    await ctx.reply(
      '❌ Ошибка при получении промокодов.'
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
        '❌ Промокод не найден.'
      );
      return;
    }

    await ctx.reply(
      `✅ Промокод ${code} удалён.`
    );

  } catch (err) {
    console.error('delpromo error:', err);

    await ctx.reply(
      '❌ Ошибка при удалении промокода.'
    );
  }
});

bot.command('echo', async (ctx) => {
  await ctx.reply(`Ваш chat.id: ${ctx.message.chat.id}`);
});

// --- Периодическая проверка ордеров ---
// async function checkOrdersPeriodically() {
//   try {
//     const orders = await knex('my_orders')
//       .whereNot({ status: 'Выполнен' })
//       .select('order_id', 'address', 'status', 'price', 'product_id', 'created_at');

//     for (const order of orders) {
//       const balance = await getBalance(order.address);

//       console.log("balance", balance);
      

//       if (balance.received === null) continue; // ошибка API — пропускаем

//       const paidAmount = balance.received;
//       const requiredAmount = order.price;

//       // Оплата получена
//       if (paidAmount >= requiredAmount) {
//         // Берем товар из my_products по product_id
//         const [item] = await knex('my_products').where({ product_id: order.product_id });
//         if (item) {
//           await knex('my_products')
//             .where({ product_id: item.product_id, product_data: item.product_data })
//             .del();
//           await knex('my_orders')
//             .where({ order_id: order.order_id })
//             .update({
//               status: 'Выполнен',
//               product_data: item.product_data,
//             });
//         }
//         continue;
//       }

//       // Есть неподтвержденные средства
//       if (balance.unconfirmed >= requiredAmount) {
//         await knex('my_orders')
//           .where({ order_id: order.order_id })
//           .update({ status: 'В ожидании подтверждений' });
//         continue;
//       }

//       // Проверка истечения времени (90 минут)
//       const createdAt = new Date(order.created_at);
//       const now = new Date();
//       const diffMs = now.getTime() - createdAt.getTime();
//       const ninetyMinutesMs = 90 * 60 * 1000;

//       if (diffMs >= ninetyMinutesMs) {
//         await knex('my_orders')
//           .where({ order_id: order.order_id }) // добавил в обьект status: "Отменен"
//           .del();
//       }
//     }
//   } catch (err) {
//     console.error('checkOrdersPeriodically error', err);
//   }
// }



// --- Запуск ---

bot.launch().then(() => {
  // setInterval(checkOrdersPeriodically, TenMinutes);
  console.log("STARTED");
});
