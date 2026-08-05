// ponytail: curated, best-effort vendor fingerprints. A vendor not appearing here simply
// won't be detected (a silent false negative, never a guess) - extend this list as real
// sites surface vendors it's missing. Deliberately excluded a few vendors from the user's
// requested list whose real domain I don't have solid knowledge of AND whose product name
// is generic enough that a wrong guess could collide with an unrelated company's real site
// (a false positive, much worse than a false negative): Auto/Mate ("automate.com" is a
// far too common a phrase to guess safely), "Inventory+", and "Simple Scheduler" (both
// generic product-descriptor names, no distinctive string to even guess from). Add these
// once a real, verified domain is known.
//
// Each entry's `domain` regex is checked against EVERY URL-bearing evidence source
// (script/iframe src, inline script content, meta tags, JSON-LD, form fields, stylesheet
// hrefs, link hrefs) - see techMatch.js for how that's tiered into confidence. `metaExtra`
// overrides the meta-tag check for vendors whose page-metadata fingerprint doesn't share
// the same pattern as their script/domain (e.g. Dealer.com's "ddc:" meta-key prefix,
// distinct from its script paths). `namePattern` (plain vendor name, not a domain) enables
// footer "Powered by X" / "Designed by X" credit-line detection against page text -
// dealership sites very commonly disclose their website platform/DMS this way.
export const SIGNATURES = [
  // --- Website Provider ---
  { name: 'Dealer.com', category: 'website_provider',
    domain: /\/ddc[-.]|ddc-js-api|ddc\.min\.js|ddc-core-js-polyfills|ddc-tracking-helpers|ddc-phone-swapping|ddc-data-layer|ddc-section-animations/i,
    metaExtra: /\bddc:/i, namePattern: /Dealer\.com/i },
  { name: 'Dealer Inspire', category: 'website_provider', domain: /dealerinspire\.com|di-cdn\.com/i, namePattern: /Dealer\s*Inspire/i },
  { name: 'DealerOn', category: 'website_provider', domain: /dealeron\.com/i, namePattern: /Dealer\s*On/i },
  { name: 'DealerFire', category: 'website_provider', domain: /dealerfire\.com/i, namePattern: /Dealer\s*Fire/i },
  { name: 'Dealer eProcess', category: 'website_provider', domain: /dealereprocess\.(com|net)/i, namePattern: /Dealer\s*eProcess/i },
  { name: 'Dealer Spike', category: 'website_provider', domain: /dealerspike\.com/i, namePattern: /Dealer\s*Spike/i },
  { name: 'CDK Global', category: 'website_provider', domain: /cdk(?:global)?\.com/i, namePattern: /CDK(?:\s*Global)?\b/i },
  { name: 'DealerCarSearch', category: 'website_provider', domain: /dealercarsearch\.com/i },
  { name: 'AutoRevo', category: 'website_provider', domain: /autorevo\.com/i, namePattern: /AutoRevo/i },
  { name: 'Sincro', category: 'website_provider', domain: /sincro(?:digital)?\.com/i, namePattern: /Sincro/i },
  { name: 'Naked Lime', category: 'website_provider', domain: /nakedlime\.com/i },

  // --- Chat ---
  { name: 'Gubagoo', category: 'chat', domain: /gubagoo\.(io|com)/i },
  { name: 'Podium', category: 'chat', domain: /podium\.com/i },
  { name: 'CarNow', category: 'chat', domain: /carnow\.com/i },
  { name: 'ActivEngage', category: 'chat', domain: /activengage\.com/i },
  { name: 'Impel', category: 'chat', domain: /impel\.(ai|io)/i },
  { name: 'Fullpath', category: 'chat', domain: /fullpath\.com/i },
  { name: 'Intercom', category: 'chat', domain: /intercom\.io|intercomcdn\.com/i },
  { name: 'Drift', category: 'chat', domain: /js\.driftt\.com|drift\.com/i },
  { name: 'HubSpot Chat', category: 'chat', domain: /js\.?(?:-na1)?\.hs-scripts\.com|js\.usemessages\.com/i },
  { name: 'LiveChat', category: 'chat', domain: /livechatinc\.com/i },
  { name: 'Tidio', category: 'chat', domain: /code\.tidio\.co/i },
  { name: 'Olark', category: 'chat', domain: /olark\.com/i },
  { name: 'Zendesk', category: 'chat', domain: /zdassets\.com|zendesk\.com/i },
  { name: 'Freshchat', category: 'chat', domain: /freshchat\.com/i },
  { name: 'LivePerson', category: 'chat', domain: /liveperson\.net/i },
  { name: 'Salesforce Chat', category: 'chat', domain: /salesforceliveagent\.com|service\.force\.com/i },

  // --- CRM ---
  { name: 'VinSolutions', category: 'crm', domain: /vinsolutions\.com/i },
  { name: 'DriveCentric', category: 'crm', domain: /drivecentric\.com/i },
  { name: 'DealerSocket CRM', category: 'crm', domain: /dealersocket\.com/i },
  { name: 'Elead CRM', category: 'crm', domain: /elead-?crm\.com|elead1one\.com/i },
  { name: 'Tekion CRM', category: 'crm', domain: /tekion\.com/i },
  { name: 'Reynolds CRM', category: 'crm', domain: /reyrey\.com/i },
  { name: 'CDK CRM', category: 'crm', domain: /cdk(?:global)?\.com/i },
  { name: 'Dominion Vision', category: 'crm', domain: /dominionvision\.com|dominiondealer\.com/i },
  { name: 'AutoAlert', category: 'crm', domain: /autoalert\.com/i },
  { name: 'ProMax', category: 'crm', domain: /promax(?:unlimited)?\.com/i },
  { name: 'HubSpot CRM', category: 'crm', domain: /hs-analytics\.net|hs-scripts\.com|hsforms\.net/i },
  { name: 'Salesforce CRM', category: 'crm', domain: /force\.com|salesforce\.com/i },

  // --- Service Scheduler (frequently just a plain link or a form action pointing at the
  // vendor's hosted booking page, rather than a sitewide script - see indirect tier above) ---
  { name: 'Xtime', category: 'scheduling', domain: /xtime\.com/i },
  { name: 'Tekion Scheduler', category: 'scheduling', domain: /tekion\.com/i },
  { name: 'DealerSocket Scheduler', category: 'scheduling', domain: /dealersocket\.com/i },
  { name: 'CDK Service', category: 'scheduling', domain: /cdk(?:global)?\.com/i },
  { name: 'Reynolds Scheduler', category: 'scheduling', domain: /reyrey\.com/i },
  { name: 'MyKaarma', category: 'scheduling', domain: /mykaarma\.com/i },
  { name: 'Calendly', category: 'scheduling', domain: /calendly\.com/i },
  { name: 'TimeHighway', category: 'scheduling', domain: /timehighway\.com/i },
  { name: 'Dealer-FX', category: 'scheduling', domain: /dealer-fx\.com/i },

  // --- IMS (Inventory Management System) ---
  { name: 'vAuto', category: 'ims', domain: /vauto\.com/i },
  { name: 'HomeNet', category: 'ims', domain: /homenet(?:inc|automotive)?\.com/i },
  { name: 'VINCue', category: 'ims', domain: /vincue\.com/i },
  { name: 'Max Digital', category: 'ims', domain: /maxdigital\.com/i },
  { name: 'Dealer Specialties', category: 'ims', domain: /dealerspecialties\.com/i },
  { name: 'AutoSweet', category: 'ims', domain: /autosweet\.com/i },
  { name: 'CarOffer Inventory', category: 'ims', domain: /caroffer\.com/i },
  { name: 'Rapid Recon', category: 'ims', domain: /rapidrecon\.com/i },

  // --- DMS (Dealer Management System) ---
  { name: 'CDK Global', category: 'dms', domain: /cdk(?:global)?\.com/i, namePattern: /CDK(?:\s*Global)?\b/i },
  { name: 'Reynolds & Reynolds', category: 'dms', domain: /reyrey\.com/i, namePattern: /Reynolds\s*(?:(?:and|&)\s*Reynolds)?\b/i },
  { name: 'Tekion DMS', category: 'dms', domain: /tekion\.com/i },
  { name: 'Dealertrack DMS', category: 'dms', domain: /dealertrack\.com/i },
  { name: 'Dominion DMS', category: 'dms', domain: /dominiondealer\.com|dominionvision\.com/i },
  { name: 'AutoSoft DMS', category: 'dms', domain: /autosoftdms\.com/i },
  { name: 'PBS Systems', category: 'dms', domain: /pbssystems\.com/i },
  { name: 'Quorum DMS', category: 'dms', domain: /quorumdms\.com/i },
  { name: 'DealerBuilt', category: 'dms', domain: /dealerbuilt\.com/i },

  // --- Inventory / Digital Retail ---
  { name: 'Roadster', category: 'digital_retail', domain: /roadster\.com/i },
  { name: 'AutoFi', category: 'digital_retail', domain: /autofi\.com/i },
  { name: 'Darwin Automotive', category: 'digital_retail', domain: /darwinautomotive\.com|darwinapps\.com/i },
  { name: 'Motoinsight', category: 'digital_retail', domain: /motoinsight\.com/i },

  // --- Reputation ---
  { name: 'Birdeye', category: 'reputation', domain: /birdeye\.com/i },
  { name: 'Reputation.com', category: 'reputation', domain: /reputation\.com/i },
  { name: 'DealerRater', category: 'reputation', domain: /dealerrater\.com/i },

  // --- Analytics ---
  { name: 'Google Analytics', category: 'analytics', domain: /google-analytics\.com|gtag\/js/i },
  { name: 'Google Tag Manager', category: 'analytics', domain: /googletagmanager\.com/i },
  { name: 'Adobe Analytics', category: 'analytics', domain: /omtrdc\.net|2o7\.net|adobedtm\.com/i },
  { name: 'Meta Pixel', category: 'analytics', domain: /connect\.facebook\.net.*fbevents/i },
  { name: 'LinkedIn Insight', category: 'analytics', domain: /snap\.licdn\.com/i },
  { name: 'TikTok Pixel', category: 'analytics', domain: /analytics\.tiktok\.com/i },
  { name: 'Microsoft Clarity', category: 'analytics', domain: /clarity\.ms/i },
  { name: 'Hotjar', category: 'analytics', domain: /static\.hotjar\.com/i },
  { name: 'Google Ads', category: 'analytics', domain: /googleadservices\.com|googlesyndication\.com/i },
];
