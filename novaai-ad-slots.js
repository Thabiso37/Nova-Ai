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
    {slot_id:'motors_banner',page:'motors',element_id:'motorsAdSlot',format:'banner',max_creatives:5,rotation_seconds:5.2}
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
  window.NOVAAI_ADS=api;
  document.querySelectorAll('[data-nova-ad-slot]').forEach(el=>{
    const id=el.getAttribute('data-nova-ad-slot');
    const placement=placements.find(p=>p.slot_id===id);
    if(placement){el.setAttribute('data-nova-ad-status','ready_for_admin_management');el.setAttribute('data-nova-ad-contract-version','1');}
  });
})();
