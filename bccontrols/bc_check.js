import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

export default async function bc_check() {
    const address = process.env.BCAD; // твой BTC-адрес
    const token = process.env.BLOCKCYPHER_API_TOKEN;

    if (!token) {
        throw new Error('BLOCKCYPHER_API_TOKEN не найден');
    }

    const url = `https://api.blockcypher.com/v1/btc/main/addrs/${address}?token=${token}`;

    await axios.get(url)
    .then(res => {
        console.log('Баланс (сатоши):', res.data);
        console.log('Неподтверждённый баланс (сатоши):', res.data.unconfirmed_balance);
    })
    .catch(err => {
        console.error('Ошибка:', err.response?.status, err.response?.data);
    });
}