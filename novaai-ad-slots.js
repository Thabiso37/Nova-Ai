/* NOVAAI Advertisement Placement Registry
 * Version 1 contract for the future Admin > Advertisement Management page.
 * This file does not access Supabase or publish campaigns yet.
 */
(function(){
  'use strict';
  const placements = [
    {slot_id:'home_hero',page:'home',element_id:'novaHeroCarousel',format:'carousel',max_creatives:10,rotation_seconds:5.2},
    {slot_id:'wishlist_banner',page:'wishlist',element_id:'wishlistAdSlot',format:'banner',max_creatives:5,rotation_seconds:5.2},
    {slot_id:'property_banner',page:'property',element_id:'propertyAdSlot',format:'banner',max_creatives:5,rotation_seconds:5.2},
    {slot_id:'motors_banner',page:'motors',element_id:'motorsWelcomeAd',format:'carousel',max_creatives:5,rotation_seconds:5.2}
  ].map(item=>Object.freeze({...item,status:'ready_for_admin_management'}));
  const requiredCampaignFields=['campaign_id','slot_id','title','description','creative_type','creative_url','destination_url','status','starts_at','ends_at','priority'];
  const api={
    version:1,
    placements:Object.freeze(placements),
    requiredCampaignFields:Object.freeze(requiredCampaignFields),
    getPlacements(){return placements.map(item=>({...item}));},
    getPlacement(slotId){const item=placements.find(p=>p.slot_id===String(slotId));return item?{...item}:null;},
    announceCampaigns(campaigns){
      const safe=Array.isArray(campaigns)?campaigns.filter(c=>c&&placements.some(p=>p.slot_id===c.slot_id)).map(c=>({...c})):[];
      window.dispatchEvent(new CustomEvent('novaai:ads:campaigns-ready',{detail:{version:1,campaigns:safe}}));
      return safe.length;
    }
  };

  const liveMessages={
    wishlist_banner:[
      ['Discover more from South African sellers.','Fresh finds and local offers are waiting for you.','Your next favourite could be one tap away.'],
      ['Promotional space ready for campaigns managed by NOVAAI.','Explore more products from independent local stores.','Save the products you love and discover something new.'],
      ['Explore marketplace →','Discover local finds →','Shop South African sellers →']
    ],
    motors_banner:[
      ['Find your next vehicle.','Your next journey starts here.','Discover a vehicle that moves you.'],
      ['Browse vehicles listed by South African sellers, with the details they provide.','Explore cars, bakkies, SUVs and motorcycles from local sellers.','Compare listings and discover your next great drive.'],
      ['Explore vehicles →','Browse Motors →','Find your next drive →']
    ],
    property_banner:[
      ['Find a place to belong.','Your next address could be waiting here.','Explore spaces that feel like home.'],
      ['Explore homes and spaces across South Africa.','Discover property listings from local sellers.','Browse places to live, work and invest.'],
      ['Explore properties →','Discover property →','Find your space →']
    ]
  };
  function initLiveSlot(slot){
    if(!slot||slot.dataset.novaLiveReady==='1')return;
    const id=slot.getAttribute('data-nova-ad-slot');
    if(!liveMessages[id])return;
    const selectors=id==='property_banner'
      ? ['.property-promo-copy h2','.property-promo-copy p','.property-promo-link']
      : id==='motors_banner'
      ? ['.motors-hero-copy h1','.motors-hero-copy p','.motors-explore']
      : ['strong','small','a'];
    const nodes=selectors.map(sel=>slot.querySelector(sel));
    if(nodes.some(n=>!n))return;
    const original=nodes.map(n=>n.textContent);
    const variants=liveMessages[id];
    let active=0,timer=null;
    slot.dataset.novaLiveReady='1';
    slot.classList.add('nova-live-ad');
    const controls=document.createElement('div');
    controls.className='nova-live-controls';
    controls.innerHTML='<span class="nova-live-onair">NOW SHOWING</span><span class="nova-live-dots"><button type="button" aria-label="Advertisement 1" aria-current="true"></button><button type="button" aria-label="Advertisement 2" aria-current="false"></button><button type="button" aria-label="Advertisement 3" aria-current="false"></button></span>';
    slot.appendChild(controls);
    const dots=Array.from(controls.querySelectorAll('button'));
    function show(i){
      active=(i+3)%3;
      slot.classList.add('nova-live-changing');
      window.setTimeout(()=>{
        nodes.forEach((node,j)=>{node.textContent=active===0?original[j]:variants[j][active-1];});
        dots.forEach((dot,k)=>dot.setAttribute('aria-current',String(k===active)));
        slot.classList.remove('nova-live-changing');
      },220);
    }
    function stop(){if(timer){clearInterval(timer);timer=null;}}
    function start(){stop();if(!document.hidden&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)timer=setInterval(()=>show(active+1),5200);}
    dots.forEach((dot,i)=>dot.addEventListener('click',()=>{show(i);start();}));
    slot.addEventListener('mouseenter',stop);slot.addEventListener('mouseleave',start);
    slot.addEventListener('focusin',stop);slot.addEventListener('focusout',start);
    document.addEventListener('visibilitychange',start);
    show(0);start();
  }
  function initHomeCarousel(){
    const banner=document.getElementById('novaHeroCarousel');
    if(!banner||banner.dataset.novaLiveReady==='1')return;
    const slides=Array.from(banner.querySelectorAll('.nova-hero-slide'));
    const dots=Array.from(banner.querySelectorAll('[data-hero-slide]'));
    const prev=banner.querySelector('#novaHeroPrev'),next=banner.querySelector('#novaHeroNext');
    if(slides.length<2)return;
    banner.dataset.novaLiveReady='1';
    let active=0,timer=null;
    function show(i){active=(i+slides.length)%slides.length;slides.forEach((el,k)=>{el.classList.toggle('active',k===active);el.setAttribute('aria-hidden',String(k!==active));});dots.forEach((el,k)=>el.classList.toggle('active',k===active));}
    function stop(){if(timer){clearInterval(timer);timer=null;}}
    function start(){stop();if(!document.hidden&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)timer=setInterval(()=>show(active+1),5200);}
    dots.forEach((dot,i)=>dot.addEventListener('click',()=>{show(i);start();}));
    prev&&prev.addEventListener('click',()=>{show(active-1);start();});
    next&&next.addEventListener('click',()=>{show(active+1);start();});
    banner.addEventListener('mouseenter',stop);banner.addEventListener('mouseleave',start);
    banner.addEventListener('focusin',stop);banner.addEventListener('focusout',start);
    document.addEventListener('visibilitychange',start);show(0);start();
  }
  function bootLiveAds(){
    initHomeCarousel();
    ['wishlist_banner','property_banner','motors_banner'].forEach(id=>initLiveSlot(document.querySelector('[data-nova-ad-slot="'+id+'"]')));
    if(!window.__novaAdObserver&&document.body){window.__novaAdObserver=new MutationObserver(()=>{const wishlist=document.querySelector('[data-nova-ad-slot="wishlist_banner"]');if(wishlist)initLiveSlot(wishlist);});window.__novaAdObserver.observe(document.body,{childList:true,subtree:true});}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootLiveAds,{once:true});else bootLiveAds();

  window.NOVAAI_ADS=api;
  const style=document.createElement('style');
  style.textContent='.nova-live-ad{position:relative;isolation:isolate;overflow:hidden}.nova-live-ad:before{content:"";position:absolute;inset:-45%;z-index:0;pointer-events:none;background:linear-gradient(110deg,transparent 38%,rgba(255,255,255,.13) 48%,transparent 58%);transform:translateX(-65%) rotate(8deg);animation:novaAdShimmer 6s ease-in-out infinite}.nova-live-ad:after{content:"";position:absolute;z-index:0;right:-35px;top:-55px;width:145px;height:145px;border:1px solid rgba(255,255,255,.2);border-radius:50%;box-shadow:0 0 0 18px rgba(255,255,255,.035),0 0 0 38px rgba(255,255,255,.025);pointer-events:none;animation:novaAdOrbit 9s linear infinite}.nova-live-ad>*{position:relative;z-index:1}.nova-live-ad .nova-live-controls{position:absolute;z-index:5;right:12px;bottom:9px;display:flex;align-items:center;gap:9px}.nova-live-onair{font-size:7px;font-weight:900;letter-spacing:1px;color:rgba(255,255,255,.82)}.nova-live-onair:before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:#f5b900;margin-right:5px;box-shadow:0 0 8px #f5b900;animation:novaAdPulse 1.4s infinite}.nova-live-dots{display:flex;gap:5px}.nova-live-dots button{width:6px;height:6px;padding:0;border:0;border-radius:9px;background:#ffffff75}.nova-live-dots button[aria-current="true"]{width:18px;background:#f5b900}.nova-live-changing .property-promo-copy,.nova-live-changing strong,.nova-live-changing small{opacity:.25;transition:opacity .22s ease}@keyframes novaAdShimmer{0%,15%{transform:translateX(-65%) rotate(8deg)}65%,100%{transform:translateX(65%) rotate(8deg)}}@keyframes novaAdOrbit{to{transform:rotate(360deg)}}@keyframes novaAdPulse{50%{opacity:.45;box-shadow:0 0 0 6px rgba(245,185,0,.1)}}@media(prefers-reduced-motion:reduce){.nova-live-ad:before,.nova-live-ad:after,.nova-live-onair:before{animation:none!important}}';
  document.head.appendChild(style);
  document.querySelectorAll('[data-nova-ad-slot]').forEach(el=>{
    const id=el.getAttribute('data-nova-ad-slot');
    const placement=placements.find(p=>p.slot_id===id);
    if(placement){el.setAttribute('data-nova-ad-status','ready_for_admin_management');el.setAttribute('data-nova-ad-contract-version','1');}
  });
})();
