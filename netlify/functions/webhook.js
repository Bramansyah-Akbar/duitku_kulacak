const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MY_TELEGRAM_ID = parseInt(process.env.MY_TELEGRAM_ID);
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        
        if (!body.message || !body.message.text) {
            return { statusCode: 200, body: 'No message text found' };
        }

        const chatId = body.message.chat.id;
        const userId = body.message.from.id;
        const textInput = body.message.text.trim();

        if (userId !== MY_TELEGRAM_ID) {
            await sendTelegramReply(chatId, "❌ Akses Ditolak.");
            return { statusCode: 200, body: 'Unauthorized' };
        }

        const tokens = textInput.split(/\s+/);
        
        let txType = 'EXPENSE';
        let amount = 0;
        let note = '';
        let fromAccountName = '';
        let toAccountName = '';
        let categoryName = 'Lainnya';

        if (tokens[0].toLowerCase() === 'trf') {
            txType = 'TRANSFER';
            fromAccountName = tokens[1];
            toAccountName = tokens[2];
            amount = parseFloat(tokens[3]);
            note = `Transfer dari ${fromAccountName} ke ${toAccountName}`;
        } else if (tokens[0].toLowerCase() === 'gaji' || tokens[0].toLowerCase() === 'income') {
            txType = 'INCOME';
            note = tokens[0];
            amount = parseFloat(tokens[1]);
            toAccountName = tokens[2];
        } else {
            txType = 'EXPENSE';
            note = tokens[0];
            amount = parseFloat(tokens[1]);
            fromAccountName = tokens[2];
            categoryName = detectCategory(note);
        }

        if (isNaN(amount) || amount <= 0) {
            await sendTelegramReply(chatId, "⚠️ Format salah!");
            return { statusCode: 200, body: 'Bad format' };
        }

        let fromAccountId = null;
        let toAccountId = null;
        let categoryId = null;

        // 🔍 DIAGNOSTIK KANTONG ASAL
        if (fromAccountName) {
            const { data: acc, error: accError } = await supabase.from('accounts').select('id, current_balance').ilike('name', fromAccountName).single();
            
            // JIKA ADA EROR DARI SUPABASE, KIRIM LANGSUNG KE TELEGRAM
            if (accError) {
                await sendTelegramReply(chatId, `🪲 **Supabase Debug:**\nCode: \`${accError.code}\`\nMessage: \`${accError.message}\``);
            }

            if (!acc) return await replyAccountNotFound(chatId, fromAccountName);
            fromAccountId = acc.id;
            
            await supabase.from('accounts').update({ current_balance: parseFloat(acc.current_balance) - amount }).eq('id', fromAccountId);
        }

        // 🔍 DIAGNOSTIK KANTONG TUJUAN
        if (toAccountName) {
            const { data: acc, error: accError } = await supabase.from('accounts').select('id, current_balance').ilike('name', toAccountName).single();
            
            if (accError) {
                await sendTelegramReply(chatId, `🪲 **Supabase Debug:**\nCode: \`${accError.code}\`\nMessage: \`${accError.message}\``);
            }

            if (!acc) return await replyAccountNotFound(chatId, toAccountName);
            toAccountId = acc.id;

            await supabase.from('accounts').update({ current_balance: parseFloat(acc.current_balance) + amount }).eq('id', toAccountId);
        }

        if (txType === 'EXPENSE') {
            const { data: cat } = await supabase.from('categories').select('id').ilike('name', categoryName).single();
            if (cat) categoryId = cat.id;
        }

        const { error: insertError } = await supabase.from('transactions').insert([{
            type: txType,
            amount: amount,
            from_account_id: fromAccountId,
            to_account_id: toAccountId,
            category_id: categoryId,
            note: note
        }]);

        if (insertError) throw insertError;

        const successMessage = `✅ **Berhasil Dicatat!**\n\n🔹 Tipe: ${txType}\n💵 Nominal: Rp ${amount.toLocaleString('id-ID')}\n📝 Catatan: ${note}`;
        await sendTelegramReply(chatId, successMessage);

        return { statusCode: 200, body: 'Success' };

    } catch (error) {
        return { statusCode: 200, body: 'Error' };
    }
};

async function sendTelegramReply(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
}

async function replyAccountNotFound(chatId, accName) {
    await sendTelegramReply(chatId, `⚠️ Akun dengan nama "${accName}" tidak ditemukan di database Supabase kamu!`);
    return { statusCode: 200, body: 'Account not found' };
}

function detectCategory(note) {
    const n = note.toLowerCase();
    if (n.includes('makan') || n.includes('kfc') || n.includes('jajan') || n.includes('kopi')) return 'Makanan';
    if (n.includes('bensin') || n.includes('gojek') || n.includes('grab') || n.includes('bus')) return 'Transport';
    if (n.includes('steam') || n.includes('game') || n.includes('netflix')) return 'Hiburan';
    if (n.includes('listrik') || n.includes('wifi') || n.includes('pulsa')) return 'Tagihan';
    return 'Belanja';
}