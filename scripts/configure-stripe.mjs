import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

export function validateStripeKeyMode(key, mode) {
  if (!['test', 'live'].includes(mode)) throw new Error('Use test or live');
  if (!new RegExp(`^(?:sk|rk)_${mode}_`).test(key)) throw new Error('Key mode mismatch');
}

export async function ensurePortalConfiguration(stripe, mode) {
  if (!['test', 'live'].includes(mode)) throw new Error('Use test or live');
  const settings = {
    business_profile: {
      headline: 'Manage your Claude Motion Video subscription',
      privacy_policy_url: 'https://claudemotionvideo.com/privacy',
      terms_of_service_url: 'https://claudemotionvideo.com/terms',
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
    default_return_url: 'https://claudemotionvideo.com/studio',
    metadata: { cmv_app: 'claudemotionvideo' },
  };
  let marked;
  let legacy;
  for await (const configuration of stripe.billingPortal.configurations.list({ limit: 100 })) {
    if (configuration.metadata?.cmv_app === settings.metadata.cmv_app) {
      marked = configuration;
      break;
    }
    if (!legacy && configuration.default_return_url === settings.default_return_url &&
      Object.entries(settings.business_profile).every(([name, value]) => configuration.business_profile?.[name] === value)) {
      legacy = configuration;
    }
  }
  const existing = marked ?? legacy;
  const configuration = existing
    ? await stripe.billingPortal.configurations.update(existing.id, { ...settings, active: true })
    : await stripe.billingPortal.configurations.create(settings, { idempotencyKey: `cmv-portal-config-v2-${mode}` });
  if (configuration.livemode !== (mode === 'live')) throw new Error('Portal configuration mode mismatch');
  return configuration;
}

async function main() {
const mode = process.argv[2] ?? 'test';
if (!['test','live'].includes(mode)) throw new Error('Use test or live');
const key = fs.readFileSync(`.secrets/stripe-${mode}-key`,'utf8').trim();
validateStripeKeyMode(key, mode);
const stripe = new Stripe(key);
const all = await stripe.products.list({limit:100});
const prices = {};
for (const [plan,label,month,year,credits] of [['starter','Starter',1990,16680,1500],['pro','Pro',3990,28680,3600],['max','Max',7990,47880,7500]]) {
 let product = all.data.find(p=>p.metadata.cmv_plan===plan && p.active);
 if(!product) product = await stripe.products.create({name:`Claude Motion Video ${label}`,description:`${credits.toLocaleString()} credits per month. Editable AI motion graphics and 1080p MP4 export.`,metadata:{cmv_plan:plan}} ,{idempotencyKey:`cmv-product-v1-${plan}`});
 const existing = await stripe.prices.list({product:product.id,active:true,limit:100});
 prices[plan]={};
 for(const [interval,amount] of [['month',month],['year',year]]) {
  let price = existing.data.find(p=>p.recurring?.interval===interval&&p.unit_amount===amount&&p.currency==='usd');
  if(!price) price=await stripe.prices.create({product:product.id,currency:'usd',unit_amount:amount,recurring:{interval},lookup_key:`cmv_${plan}_${interval}_v1`,metadata:{cmv_plan:plan}},{idempotencyKey:`cmv-price-v1-${plan}-${interval}`});
  prices[plan][interval]=price.id;
 }
}
const portal = await ensurePortalConfiguration(stripe, mode);
fs.writeFileSync(`.secrets/stripe-${mode}-prices.json`,JSON.stringify(prices),{mode:0o600});
fs.writeFileSync(`.secrets/stripe-${mode}-portal.json`,JSON.stringify({id:portal.id}),{mode:0o600});
console.log(JSON.stringify({mode,prices,portalConfigurationId:portal.id}));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
