// ponytail: curated, best-effort vendor fingerprints (script/iframe domains, meta markers).
// A vendor not appearing here simply won't be detected (false negative, never a guess) -
// extend this list as real sites surface vendors it's missing.
//
// Each pattern's `type` says which evidence bucket it must appear in:
//   scriptSrc / iframeSrc -> a loaded script or iframe URL (strong: "official JS or iframe")
//   inline / meta / jsonld -> inline script content, page metadata, or JSON-LD (weaker)
export const SIGNATURES = [
  // --- Website Provider ---
  { name: 'Dealer.com', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /\/ddc[-.]|ddc-js-api|ddc\.min\.js|ddc-core-js-polyfills|ddc-tracking-helpers|ddc-phone-swapping|ddc-data-layer|ddc-section-animations/i },
    { type: 'meta', test: /\bddc:/i },
  ]},
  { name: 'Dealer Inspire', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /dealerinspire\.com|di-cdn\.com/i },
  ]},
  { name: 'DealerOn', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /dealeron\.com/i },
  ]},
  { name: 'DealerFire', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /dealerfire\.com/i },
  ]},
  { name: 'Dealer eProcess', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /dealereprocess\.(com|net)/i },
  ]},
  { name: 'Dealer Spike', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /dealerspike\.com/i },
  ]},
  { name: 'CDK Global', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /cdk(?:global)?\.com/i },
  ]},
  { name: 'DealerCarSearch', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /dealercarsearch\.com/i },
  ]},
  { name: 'AutoRevo', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /autorevo\.com/i },
  ]},
  { name: 'Sincro', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /sincro(?:digital)?\.com/i },
  ]},
  { name: 'Naked Lime', category: 'website_provider', patterns: [
    { type: 'scriptSrc', test: /nakedlime\.com/i },
  ]},

  // --- Chat ---
  { name: 'Gubagoo', category: 'chat', patterns: [{ type: 'scriptSrc', test: /gubagoo\.(io|com)/i }] },
  { name: 'Podium', category: 'chat', patterns: [{ type: 'scriptSrc', test: /podium\.com/i }] },
  { name: 'CarNow', category: 'chat', patterns: [{ type: 'scriptSrc', test: /carnow\.com/i }] },
  { name: 'ActivEngage', category: 'chat', patterns: [{ type: 'scriptSrc', test: /activengage\.com/i }] },
  { name: 'Impel', category: 'chat', patterns: [{ type: 'scriptSrc', test: /impel\.(ai|io)/i }] },
  { name: 'Fullpath', category: 'chat', patterns: [{ type: 'scriptSrc', test: /fullpath\.com/i }] },
  { name: 'DriveCentric', category: 'chat', patterns: [{ type: 'scriptSrc', test: /drivecentric\.com/i }] },
  { name: 'Intercom', category: 'chat', patterns: [
    { type: 'scriptSrc', test: /intercom\.io|intercomcdn\.com/i },
    { type: 'iframeSrc', test: /intercom\.io/i },
  ]},
  { name: 'Drift', category: 'chat', patterns: [{ type: 'scriptSrc', test: /js\.driftt\.com|drift\.com/i }] },
  { name: 'HubSpot Chat', category: 'chat', patterns: [
    { type: 'scriptSrc', test: /js\.?(?:-na1)?\.hs-scripts\.com|js\.usemessages\.com/i },
  ]},
  { name: 'LiveChat', category: 'chat', patterns: [{ type: 'scriptSrc', test: /livechatinc\.com/i }] },
  { name: 'Tidio', category: 'chat', patterns: [{ type: 'scriptSrc', test: /code\.tidio\.co/i }] },
  { name: 'Olark', category: 'chat', patterns: [{ type: 'scriptSrc', test: /olark\.com/i }] },
  { name: 'Zendesk', category: 'chat', patterns: [{ type: 'scriptSrc', test: /zdassets\.com|zendesk\.com/i }] },
  { name: 'Freshchat', category: 'chat', patterns: [{ type: 'scriptSrc', test: /freshchat\.com/i }] },
  { name: 'LivePerson', category: 'chat', patterns: [{ type: 'scriptSrc', test: /liveperson\.net/i }] },
  { name: 'Salesforce Chat', category: 'chat', patterns: [{ type: 'scriptSrc', test: /salesforceliveagent\.com|service\.force\.com/i }] },

  // --- CRM ---
  { name: 'VinSolutions', category: 'crm', patterns: [{ type: 'scriptSrc', test: /vinsolutions\.com/i }] },
  { name: 'DealerSocket', category: 'crm', patterns: [{ type: 'scriptSrc', test: /dealersocket\.com/i }] },
  { name: 'Elead', category: 'crm', patterns: [{ type: 'scriptSrc', test: /elead-?crm\.com/i }] },
  { name: 'Tekion', category: 'crm', patterns: [{ type: 'scriptSrc', test: /tekion\.com/i }] },
  { name: 'HubSpot CRM', category: 'crm', patterns: [{ type: 'scriptSrc', test: /hs-analytics\.net|hs-scripts\.com|hsforms\.net/i }] },
  { name: 'Salesforce', category: 'crm', patterns: [{ type: 'scriptSrc', test: /force\.com|salesforce\.com/i }] },
  { name: 'Reynolds and Reynolds', category: 'crm', patterns: [{ type: 'scriptSrc', test: /reyrey\.com/i }] },
  { name: 'ProMax', category: 'crm', patterns: [{ type: 'scriptSrc', test: /promax(?:unlimited)?\.com/i }] },
  { name: 'Dominion Vision', category: 'crm', patterns: [{ type: 'scriptSrc', test: /dominionvision\.com|dominiondealer\.com/i }] },

  // --- Inventory / Digital Retail ---
  { name: 'Roadster', category: 'digital_retail', patterns: [{ type: 'scriptSrc', test: /roadster\.com/i }] },
  { name: 'AutoFi', category: 'digital_retail', patterns: [{ type: 'scriptSrc', test: /autofi\.com/i }] },
  { name: 'Darwin Automotive', category: 'digital_retail', patterns: [{ type: 'scriptSrc', test: /darwinautomotive\.com|darwinapps\.com/i }] },
  { name: 'Motoinsight', category: 'digital_retail', patterns: [{ type: 'scriptSrc', test: /motoinsight\.com/i }] },

  // --- Reputation ---
  { name: 'Birdeye', category: 'reputation', patterns: [{ type: 'scriptSrc', test: /birdeye\.com/i }] },
  { name: 'Reputation.com', category: 'reputation', patterns: [{ type: 'scriptSrc', test: /reputation\.com/i }] },
  { name: 'DealerRater', category: 'reputation', patterns: [{ type: 'scriptSrc', test: /dealerrater\.com/i }] },

  // --- Scheduling ---
  { name: 'Xtime', category: 'scheduling', patterns: [{ type: 'scriptSrc', test: /xtime\.com/i }] },
  { name: 'Calendly', category: 'scheduling', patterns: [{ type: 'scriptSrc', test: /calendly\.com/i }] },

  // --- Analytics ---
  { name: 'Google Analytics', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /google-analytics\.com|gtag\/js/i }] },
  { name: 'Google Tag Manager', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /googletagmanager\.com/i }] },
  { name: 'Adobe Analytics', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /omtrdc\.net|2o7\.net|adobedtm\.com/i }] },
  { name: 'Meta Pixel', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /connect\.facebook\.net.*fbevents/i }] },
  { name: 'LinkedIn Insight', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /snap\.licdn\.com/i }] },
  { name: 'TikTok Pixel', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /analytics\.tiktok\.com/i }] },
  { name: 'Microsoft Clarity', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /clarity\.ms/i }] },
  { name: 'Hotjar', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /static\.hotjar\.com/i }] },
  { name: 'Google Ads', category: 'analytics', patterns: [{ type: 'scriptSrc', test: /googleadservices\.com|googlesyndication\.com/i }] },
];
