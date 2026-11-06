/* NOVAAI Advertisement Placement Registry
 * Version 1 contract for the future Admin > Advertisement Management page.
 * This file does not access Supabase or publish campaigns yet.
 */
(function(){
  'use strict';
  const placements = [
    {slot_id:'home_hero',board_number:1,label:"Home – Main advertising board",page:'home',element_id:"novaHeroCarousel",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'shop_tv',board_number:2,label:"Shop – Main carousel",page:'shop',element_id:"shopTvAds",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'cart_banner',board_number:3,label:"Cart advertising board",page:'cart',element_id:"cartAdBoard",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'wishlist_banner',board_number:4,label:"Wishlist (heart) advertising board",page:'wishlist',element_id:"wishlistAdSlot",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'motors_banner',board_number:5,label:"Motors – Main advertising board",page:'motors',element_id:"motorsWelcomeAd",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'property_banner',board_number:6,label:"Property – Main advertising board",page:'property',element_id:"propertyAdSlot",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'shop_footer',board_number:7,label:"Shop – Bottom advertising board",page:'shop',element_id:"shopFooterAd",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'motors_footer',board_number:8,label:"Motors – Bottom advertising board",page:'motors',element_id:"motorsFooterAd",format:'carousel',max_creatives:5,rotation_seconds:5},
    {slot_id:'property_footer',board_number:9,label:"Property – Bottom advertising board",page:'property',element_id:"propertyFooterAd",format:'carousel',max_creatives:5,rotation_seconds:5}
  ].map(item=>Object.freeze({...item,status:'ready_for_admin_management'}));
  const requiredCampaignFields=['campaign_id','slot_id','title','description','creative_type','creative_url','destination_url','status','starts_at','ends_at','priority','duration_seconds'];
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
    cart_banner:[
      ['Special Offers','Featured Deals','Marketplace Picks'],
      ['Discover great deals at NOVAAI','Explore offers from local sellers','Find your next favourite today']
    ],
    shop_footer:[
      ['Find something you will love.','Fresh discoveries from South African sellers.','Your next great find is waiting.'],
      ['Browse fashion, tech and home essentials.','Shop local and discover more in one place.','Explore products across the marketplace.'],
      ['Explore Shop →','Discover local finds →','Start browsing →']
    ],
    motors_footer:[
      ['Find the vehicle that moves you.','Cars, bakkies and SUVs from local sellers.','Your next journey starts here.'],
      ['Explore vehicles and useful parts.','Compare listings and discover your next drive.','Browse local Motors listings.'],
      ['Explore Motors →','Browse vehicles →','Find your next drive →']
    ],
    property_footer:[
      ['Make room for your next chapter.','Explore homes and spaces across South Africa.','Your next address could be waiting.'],
      ['Discover a place to call home.','Browse houses, apartments and more.','Find a space that fits your plans.'],
      ['Explore Property →','Browse homes →','Find your space →']
    ],
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
  const liveImages={
    shop_footer:[
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85'
    ],
    motors_footer:[
      'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=85'
    ],
    property_footer:[
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=85'
    ],
    home_hero:[
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=900&q=85",
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85"
    ],
    motors_banner:[
      "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1600&q=88",
      "https://cdn3.carrogreen.com/modules/angarslider/views/img/images/87ffe42992e630a55a52d1ea15d261711d6ed605_piece%20auto%201.jpg",
      "https://aaclinic.shop/assets/engine-parts-BlXfXwfD.jpg"
    ]
  };
  function initLiveSlot(slot){
    if(!slot||slot.dataset.novaLiveReady==='1')return;
    const id=slot.getAttribute('data-nova-ad-slot');
    if(!liveMessages[id])return;
    const selectors=id==='cart_banner'
      ? ['strong','span']
      : id==='property_banner'
      ? ['.property-promo-copy h2','.property-promo-copy p','.property-promo-link']
      : id==='motors_banner'
      ? ['.motors-hero-copy h1','.motors-hero-copy p','.motors-explore']
      : ['.nova-footer-ad-copy strong','.nova-footer-ad-copy small','.nova-footer-ad-copy a'];
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
        if(slot.dataset.novaManagedCampaign){slot.classList.remove('nova-live-changing');return;}
        nodes.forEach((node,j)=>{node.textContent=active===0?original[j]:variants[j][active-1];});
        if(id==='motors_banner'&&liveImages.motors_banner[active]){
          slot.style.backgroundImage='url("'+liveImages.motors_banner[active]+'")';
          slot.style.backgroundPosition='center 52%';
          slot.style.backgroundSize='cover';
        }
        if(liveImages[id]&&liveImages[id][active]){
          const image=slot.querySelector('.nova-footer-ad-image');
          if(image)image.style.backgroundImage='url("'+liveImages[id][active]+'")';
        }
        dots.forEach((dot,k)=>dot.setAttribute('aria-current',String(k===active)));
        slot.classList.remove('nova-live-changing');
      },220);
    }
    function stop(){if(timer){clearInterval(timer);timer=null;}}
    function start(){stop();const delay=id==='motors_banner'?5000:5200;if(!document.hidden&&(!window.matchMedia('(prefers-reduced-motion: reduce)').matches||id==='shop_footer'))timer=setInterval(()=>show(active+1),delay);}
    dots.forEach((dot,i)=>dot.addEventListener('click',()=>{show(i);start();}));
    slot.addEventListener('mouseenter',stop);slot.addEventListener('mouseleave',start);
    slot.addEventListener('focusin',stop);slot.addEventListener('focusout',start);
    document.addEventListener('visibilitychange',start);
    show(0);start();
  }
  // Admin campaign feed: management can publish approved campaign rows through NOVAAI_ADS.announceCampaigns(rows).
  const managedTimers=Object.create(null);
  function safeHttpsUrl(value){
    try{const u=new URL(String(value||''),location.href);return u.protocol==='https:'?u.href:null;}catch(e){return null;}
  }
  function campaignIsActive(c){
    if(!c||c.status!=='active')return false;
    const now=Date.now();
    if(c.starts_at){
      const start=Date.parse(c.starts_at);
      if(!Number.isFinite(start)||now<start)return false;
    }
    if(c.ends_at){
      const end=Date.parse(c.ends_at);
      if(!Number.isFinite(end)||now>=end)return false;
    }
    return true;
  }
  function adSlotIsActuallyVisible(slot){
    if(!slot||document.visibilityState==='hidden'||slot.closest('[hidden]'))return false;
    const style=window.getComputedStyle(slot);
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
    const rect=slot.getBoundingClientRect();
    return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<window.innerHeight&&rect.left<window.innerWidth;
  }
  function recordDisplayedImpression(slot,campaignCode){
    if(!slot||!campaignCode)return;
    if(!slot.__novaAdImpressions)slot.__novaAdImpressions=new Set();
    const check=()=>{
      if(slot.dataset.novaCampaignCode!==campaignCode||slot.__novaAdImpressions.has(campaignCode)||!adSlotIsActuallyVisible(slot))return;
      slot.__novaAdImpressions.add(campaignCode);
      recordAdEvent(campaignCode,'impression');
    };
    if(!slot.__novaAdVisibilityObserver&&'IntersectionObserver' in window){
      slot.__novaAdVisibilityObserver=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=0.5)){
          const current=slot.dataset.novaCampaignCode;
          if(current)recordDisplayedImpression(slot,current);
        }
      },{threshold:[0.5]});
      slot.__novaAdVisibilityObserver.observe(slot);
    }
    if(!slot.__novaAdVisibilityRefreshBound){
      slot.__novaAdVisibilityRefreshBound='1';
      document.addEventListener('visibilitychange',()=>{if(!document.hidden){const current=slot.dataset.novaCampaignCode;if(current)recordDisplayedImpression(slot,current);}});
    }
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(check);else window.setTimeout(check,0);
  }
  function bindCampaignClick(target,id){
    if(!target||target.dataset.novaAdClickBound==='1')return;
    target.dataset.novaAdClickBound='1';
    target.addEventListener('click',event=>{
      const code=target.dataset.novaAdClickCampaign;
      const destination=target.dataset.novaAdDestination;
      if(!code||!destination)return;
      recordAdEvent(code,'click');
      if(id==='motors_banner'){
        event.preventDefault();
        event.stopImmediatePropagation();
        window.location.assign(destination);
      }
    },id==='motors_banner');
  }
  function recordAdEvent(campaignCode,eventType){
    if(!campaignCode||!['impression','click'].includes(eventType))return;
    fetch('https://nxplffvklkopwfjaqexo.supabase.co/rest/v1/rpc/record_novaai_ad_event',{
      method:'POST',
      headers:{'apikey':'sb_publishable_dsWU7vWNRN2Nzi5D8JzH3g_W9vNsafQ','Authorization':'Bearer sb_publishable_dsWU7vWNRN2Nzi5D8JzH3g_W9vNsafQ','Content-Type':'application/json'},
      body:JSON.stringify({p_campaign_code:campaignCode,p_event_type:eventType}),
      keepalive:true
    }).catch(()=>{});
  }
  function setCampaignMedia(imageNode,slot,campaign,id,imageUrl){
    const isVideo=campaign.creative_type==='video';
    let host=imageNode||slot;
    if(id==='property_banner'&&imageNode&&imageNode.tagName==='IMG')host=imageNode.parentElement;
    if(!host)return;
    host.classList.add('nova-ad-media-host');
    host.style.position=host.style.position||'relative';
    host.style.overflow=host.style.overflow||'hidden';
    let video=host.querySelector(':scope > video[data-nova-ad-video]');
    if(isVideo){
      if(imageNode&&imageNode.tagName==='IMG')imageNode.style.display='none';
      if(!video){video=document.createElement('video');video.setAttribute('data-nova-ad-video','1');video.muted=true;video.defaultMuted=true;video.autoplay=true;video.loop=true;video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('muted','');video.setAttribute('aria-hidden','true');video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:0';host.insertBefore(video,host.firstChild);}
      if(video.src!==imageUrl){video.src=imageUrl;video.load();}
      const play=video.play();if(play&&typeof play.catch==='function')play.catch(()=>{});
      Array.from(host.children).forEach(child=>{if(child!==video){child.style.position=child.style.position||'relative';child.style.zIndex='1';}});
    }else{
      if(video)video.remove();
      if(id==='property_banner'&&imageNode&&imageNode.tagName==='IMG'){imageNode.style.display='';imageNode.src=imageUrl;}
      else if(imageNode){imageNode.style.backgroundImage='url("'+imageUrl.replace(/["\\]/g,'')+'")';imageNode.style.backgroundSize='cover';imageNode.style.backgroundPosition='center';}
    }
  }
  function captureAdFallback(slot,id){
    if(slot.__novaAdFallback)return;
    let selectors;
    if(id==='home_hero')selectors=['.nova-hero-slide .nova-hero-copy h1','.nova-hero-slide .nova-hero-copy p','.nova-hero-slide .nova-hero-copy a','.nova-hero-slide .nova-hero-art'];
    else if(id==='shop_tv')selectors=['.shop-tv-slide .shop-tv-copy h2','.shop-tv-slide .shop-tv-copy p','.shop-tv-slide .shop-tv-copy a','.shop-tv-slide .shop-tv-art'];
    else if(id==='cart_banner')selectors=['strong','span',null,null];
    else if(id==='motors_banner')selectors=['.motors-hero-copy h1','.motors-hero-copy p','.motors-explore',null];
    else if(id==='property_banner')selectors=['.property-promo-copy h2','.property-promo-copy p','.property-promo-link','.property-promo-photo img'];
    else selectors=['.nova-footer-ad-copy strong','.nova-footer-ad-copy small','.nova-footer-ad-copy a','.nova-footer-ad-image'];
    const nodes=selectors.map(selector=>selector?slot.querySelector(selector):null);
    slot.__novaAdFallback={slotBackgroundImage:slot.style.backgroundImage,slotHref:slot.getAttribute('href'),slotTarget:slot.getAttribute('target'),slotRel:slot.getAttribute('rel'),nodes:nodes.map(node=>node?{
      text:node.textContent,href:node.getAttribute('href'),target:node.getAttribute('target'),rel:node.getAttribute('rel'),
      backgroundImage:node.style.backgroundImage,src:node.tagName==='IMG'?node.getAttribute('src'):null,display:node.style.display
    }:null)};
  }
  function restoreAdFallback(slot,id){
    const saved=slot.__novaAdFallback;if(!saved)return;
    let selectors;
    if(id==='home_hero')selectors=['.nova-hero-slide .nova-hero-copy h1','.nova-hero-slide .nova-hero-copy p','.nova-hero-slide .nova-hero-copy a','.nova-hero-slide .nova-hero-art'];
    else if(id==='shop_tv')selectors=['.shop-tv-slide .shop-tv-copy h2','.shop-tv-slide .shop-tv-copy p','.shop-tv-slide .shop-tv-copy a','.shop-tv-slide .shop-tv-art'];
    else if(id==='cart_banner')selectors=['strong','span',null,null];
    else if(id==='motors_banner')selectors=['.motors-hero-copy h1','.motors-hero-copy p','.motors-explore',null];
    else if(id==='property_banner')selectors=['.property-promo-copy h2','.property-promo-copy p','.property-promo-link','.property-promo-photo img'];
    else selectors=['.nova-footer-ad-copy strong','.nova-footer-ad-copy small','.nova-footer-ad-copy a','.nova-footer-ad-image'];
    slot.style.backgroundImage=saved.slotBackgroundImage||'';
    slot.removeAttribute('data-nova-ad-click-campaign');slot.removeAttribute('data-nova-ad-destination');
    if(id==='cart_banner'){
      if(saved.slotHref===null)slot.removeAttribute('href');else if(saved.slotHref!==undefined)slot.setAttribute('href',saved.slotHref);
      if(saved.slotTarget===null)slot.removeAttribute('target');else if(saved.slotTarget!==undefined)slot.setAttribute('target',saved.slotTarget);
      if(saved.slotRel===null)slot.removeAttribute('rel');else if(saved.slotRel!==undefined)slot.setAttribute('rel',saved.slotRel);
    }
    selectors.forEach((selector,index)=>{
      const node=selector?slot.querySelector(selector):null;const value=saved.nodes[index];if(!node||!value)return;
      node.removeAttribute('data-nova-ad-click-campaign');node.removeAttribute('data-nova-ad-destination');
      node.textContent=value.text;
      if(value.href===null)node.removeAttribute('href');else if(value.href!==undefined)node.setAttribute('href',value.href);
      if(value.target===null)node.removeAttribute('target');else if(value.target!==undefined)node.setAttribute('target',value.target);
      if(value.rel===null)node.removeAttribute('rel');else if(value.rel!==undefined)node.setAttribute('rel',value.rel);
      node.style.backgroundImage=value.backgroundImage||'';
      if(node.tagName==='IMG'&&value.src)node.setAttribute('src',value.src);
      node.style.display=value.display||'';
    });
    slot.querySelectorAll('video[data-nova-ad-video]').forEach(video=>video.remove());
    delete slot.dataset.novaCampaignCode;slot.removeAttribute('data-nova-managed-campaign');
  }
  function applyManagedCampaigns(rows){
    const managedSlots=["home_hero","shop_tv","cart_banner","wishlist_banner","motors_banner","property_banner","shop_footer","motors_footer","property_footer"];
    managedSlots.forEach(id=>{
      if(managedTimers[id]){clearTimeout(managedTimers[id]);delete managedTimers[id];}
      const slot=document.querySelector('[data-nova-ad-slot="'+id+'"]')||document.getElementById(({home_hero:"novaHeroCarousel",shop_tv:"shopTvAds",cart_banner:"cartAdBoard",wishlist_banner:"wishlistAdSlot",motors_banner:"motorsWelcomeAd",property_banner:"propertyAdSlot",shop_footer:"shopFooterAd",motors_footer:"motorsFooterAd",property_footer:"propertyFooterAd"})[id]);
      if(!slot)return;
      captureAdFallback(slot,id);
      const campaigns=(Array.isArray(rows)?rows:[])
        .filter(c=>c&&c.slot_id===id&&campaignIsActive(c)&&safeHttpsUrl(c.creative_url)&&safeHttpsUrl(c.destination_url))
        .sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)).slice(0,5);
      if(!campaigns.length){
        restoreAdFallback(slot,id);
        slot.setAttribute('data-nova-ad-status','awaiting_management_campaign');return;
      }
      let index=0;
      const show=()=>{
        const c=campaigns[index];
        const title=String(c.title||'Featured offer').slice(0,100);
        const description=String(c.description||'Discover this featured offer.').slice(0,180);
        const href=safeHttpsUrl(c.destination_url);
        const imageUrl=safeHttpsUrl(c.creative_url);
        let titleNode=null,descNode=null,linkNode=null,imageNode=null;
        if(id==='home_hero'){
          const slide=slot.querySelector('.nova-hero-slide');
          titleNode=slide?.querySelector('.nova-hero-copy h1');descNode=slide?.querySelector('.nova-hero-copy p');linkNode=slide?.querySelector('.nova-hero-copy a');imageNode=slide?.querySelector('.nova-hero-art');
          slot.dataset.novaManagedCampaign=c.campaign_id||'managed-campaign';
        }else if(id==='shop_tv'){
          const slide=slot.querySelector('.shop-tv-slide');
          titleNode=slide?.querySelector('.shop-tv-copy h2');descNode=slide?.querySelector('.shop-tv-copy p');linkNode=slide?.querySelector('.shop-tv-copy a');imageNode=slide?.querySelector('.shop-tv-art');
          slot.dataset.novaManagedCampaign=c.campaign_id||'managed-campaign';
          if(slide){slot.querySelectorAll('.shop-tv-slide').forEach((el,k)=>{el.classList.toggle('is-active',k===0);el.setAttribute('aria-hidden',String(k!==0));});}
        }else if(id==='cart_banner'){
          titleNode=slot.querySelector('strong');descNode=slot.querySelector('span');linkNode=slot;imageNode=slot;
        }else if(id==='motors_banner'){
          titleNode=slot.querySelector('.motors-hero-copy h1');descNode=slot.querySelector('.motors-hero-copy p');linkNode=slot.querySelector('.motors-explore');imageNode=slot;
        }else if(id==='property_banner'){
          titleNode=slot.querySelector('.property-promo-copy h2');descNode=slot.querySelector('.property-promo-copy p');linkNode=slot.querySelector('.property-promo-link');imageNode=slot.querySelector('.property-promo-photo img');
        }else{
          titleNode=slot.querySelector('.nova-footer-ad-copy strong');descNode=slot.querySelector('.nova-footer-ad-copy small');linkNode=slot.querySelector('.nova-footer-ad-copy a');imageNode=slot.querySelector('.nova-footer-ad-image');
        }
        if(titleNode)titleNode.textContent=title;
        if(descNode)descNode.textContent=description;
        if(linkNode){
          if(id!=='cart_banner')linkNode.textContent=String(c.cta_text||'Explore offer →').slice(0,36);
          if(id==='motors_banner'&&linkNode.tagName==='BUTTON')linkNode.removeAttribute('onclick');
          if(linkNode.tagName==='A'){linkNode.href=href;linkNode.target='_blank';linkNode.rel='noopener noreferrer sponsored';}
          linkNode.dataset.novaAdClickCampaign=c.campaign_id||'';
          linkNode.dataset.novaAdDestination=href;
          bindCampaignClick(linkNode,id);
        }
        if(imageNode)setCampaignMedia(imageNode,slot,c,id,imageUrl);
        slot.dataset.novaManagedCampaign=c.campaign_id||'managed-campaign';
        slot.dataset.novaCampaignCode=c.campaign_id||'';
        recordDisplayedImpression(slot,c.campaign_id);
        slot.setAttribute('data-nova-ad-status','management_campaign_active');
        slot.setAttribute('aria-label','Featured advertisement: '+title);
        const delay=Math.max(2,Math.min(60,Number(c.duration_seconds)||5))*1000;
        index=(index+1)%campaigns.length;
        if(campaigns.length>1&&!document.hidden)managedTimers[id]=setTimeout(show,delay);
      };
      show();
    });
  }
  window.addEventListener('novaai:ads:campaigns-ready',event=>{
    const detail=event&&event.detail;
    if(detail&&detail.version===1)applyManagedCampaigns(detail.campaigns);
  });
  api.setCampaigns=rows=>api.announceCampaigns(rows);
  api.clearManagedCampaigns=()=>api.announceCampaigns([]);

  function initHomeCarousel(){
    const banner=document.getElementById('novaHeroCarousel');
    if(!banner||banner.dataset.novaLiveReady==='1')return;
    const slides=Array.from(banner.querySelectorAll('.nova-hero-slide'));
    const dots=Array.from(banner.querySelectorAll('[data-hero-slide]'));
    const prev=banner.querySelector('#novaHeroPrev'),next=banner.querySelector('#novaHeroNext');
    if(slides.length<2)return;
    banner.dataset.novaLiveReady='1';
    let active=0,timer=null;
    function show(i){if(banner.dataset.novaManagedCampaign)return;active=(i+slides.length)%slides.length;slides.forEach((el,k)=>{el.classList.toggle('active',k===active);el.setAttribute('aria-hidden',String(k!==active));const art=el.querySelector('.nova-hero-art');if(art&&liveImages.home_hero[ k ]){art.style.backgroundImage='linear-gradient(90deg,rgba(16,40,75,.10),rgba(16,40,75,.10)),url("'+liveImages.home_hero[k]+'")';art.style.backgroundSize='cover';art.style.backgroundPosition='center';}});dots.forEach((el,k)=>el.classList.toggle('active',k===active));}
    function stop(){if(timer){clearInterval(timer);timer=null;}}
    function start(){stop();if(!document.hidden&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)timer=setInterval(()=>show(active+1),5000);}
    dots.forEach((dot,i)=>dot.addEventListener('click',()=>{show(i);start();}));
    prev&&prev.addEventListener('click',()=>{show(active-1);start();});
    next&&next.addEventListener('click',()=>{show(active+1);start();});
    banner.addEventListener('mouseenter',stop);banner.addEventListener('mouseleave',start);
    banner.addEventListener('focusin',stop);banner.addEventListener('focusout',start);
    document.addEventListener('visibilitychange',start);show(0);start();
  }
  async function loadManagedCampaigns(){
    const apiUrl='https://nxplffvklkopwfjaqexo.supabase.co/rest/v1/rpc/get_live_novaai_ad_campaigns';
    const publishableKey='sb_publishable_dsWU7vWNRN2Nzi5D8JzH3g_W9vNsafQ';
    try{
      const response=await fetch(apiUrl,{method:'POST',headers:{'apikey':publishableKey,'Authorization':'Bearer '+publishableKey,'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error('Campaign feed returned HTTP '+response.status);
      const campaigns=await response.json();
      api.announceCampaigns(Array.isArray(campaigns)?campaigns:[]);
    }catch(error){console.warn('NOVAAI managed advertisement feed unavailable; managed campaigns cleared.',error);api.announceCampaigns([]);}
  }
  function bootLiveAds(){
    initHomeCarousel();
    ['cart_banner','wishlist_banner','property_banner','motors_banner','shop_footer','motors_footer','property_footer'].forEach(id=>initLiveSlot(document.querySelector('[data-nova-ad-slot="'+id+'"]')));
    loadManagedCampaigns();
    if(!window.__novaAdRefreshTimer)window.__novaAdRefreshTimer=window.setInterval(loadManagedCampaigns,60000);
    if(!window.__novaAdObserver&&document.body){window.__novaAdObserver=new MutationObserver(()=>{const wishlist=document.querySelector('[data-nova-ad-slot="wishlist_banner"]');if(wishlist)initLiveSlot(wishlist);});window.__novaAdObserver.observe(document.body,{childList:true,subtree:true});}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootLiveAds,{once:true});else bootLiveAds();

  window.NOVAAI_ADS=api;
  const style=document.createElement('style');
  style.textContent='.nova-live-ad{position:relative;isolation:isolate;overflow:hidden}.nova-live-ad:before{content:"";position:absolute;inset:-45%;z-index:0;pointer-events:none;background:linear-gradient(110deg,transparent 38%,rgba(255,255,255,.13) 48%,transparent 58%);transform:translateX(-65%) rotate(8deg);animation:novaAdShimmer 6s ease-in-out infinite}.nova-live-ad:after{content:"";position:absolute;z-index:0;right:-35px;top:-55px;width:145px;height:145px;border:1px solid rgba(255,255,255,.2);border-radius:50%;box-shadow:0 0 0 18px rgba(255,255,255,.035),0 0 0 38px rgba(255,255,255,.025);pointer-events:none;animation:novaAdOrbit 9s linear infinite}.nova-live-ad>*{position:relative;z-index:1}.nova-hero-art{background-size:cover!important;background-position:center!important}.nova-hero-art .hero-art-circle{opacity:.16}.nova-hero-art .hero-art-card{background:rgba(16,40,75,.88);backdrop-filter:blur(3px)}.nova-live-ad .nova-live-controls{position:absolute;z-index:5;right:12px;bottom:9px;display:flex;align-items:center;gap:9px}.nova-live-onair{font-size:7px;font-weight:900;letter-spacing:1px;color:rgba(255,255,255,.82)}.nova-live-onair:before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:#f5b900;margin-right:5px;box-shadow:0 0 8px #f5b900;animation:novaAdPulse 1.4s infinite}.nova-live-dots{display:flex;gap:5px}.nova-live-dots button{width:6px;height:6px;padding:0;border:0;border-radius:9px;background:#ffffff75}.nova-live-dots button[aria-current="true"]{width:18px;background:#f5b900}.nova-live-changing .property-promo-copy,.nova-live-changing strong,.nova-live-changing small{opacity:.25;transition:opacity .22s ease}@keyframes novaAdShimmer{0%,15%{transform:translateX(-65%) rotate(8deg)}65%,100%{transform:translateX(65%) rotate(8deg)}}@keyframes novaAdOrbit{to{transform:rotate(360deg)}}@keyframes novaAdPulse{50%{opacity:.45;box-shadow:0 0 0 6px rgba(245,185,0,.1)}}@media(prefers-reduced-motion:reduce){.nova-live-ad:before,.nova-live-ad:after,.nova-live-onair:before{animation:none!important}}';
  document.head.appendChild(style);
  document.querySelectorAll('[data-nova-ad-slot]').forEach(el=>{
    const id=el.getAttribute('data-nova-ad-slot');
    const placement=placements.find(p=>p.slot_id===id);
    if(placement){el.setAttribute('data-nova-ad-status','ready_for_admin_management');el.setAttribute('data-nova-ad-contract-version','1');}
  });
})();
