import { generateSecret, hashSecret } from './lib/secrets';

/**
 * Makes a credential for a bot account: `node dist/bot-secret.js <key>`, where key is the
 * bot's entry under `bots:` in lala.yaml. In the container:
 * `docker compose exec api node dist/bot-secret.js radio`.
 */
const key = process.argv[2] ?? '';
if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(key)) {
    console.error('Usage: node dist/bot-secret.js <bot key, lowercase letters, digits and dashes>');
    process.exit(2);
}

const secret = generateSecret();
hashSecret(secret).then((hash) => {
    console.log(`Credential for the bot (shown only now; send it as "Authorization: Bearer <credential>"):\n\n  ${key}.${secret}\n`);
    console.log(`In lala.yaml:\n\nbots:\n  ${key}:\n    secret: "${hash}"\n`);
}, (err) => {
    console.error(err);
    process.exit(1);
});
