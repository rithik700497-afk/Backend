// Shared between the customer-facing orders route and the admin/ops
// route so both compute the exact same status chains — brief §13's exact
// wording, varying only by vendor mode / fulfilment / scheduled-vs-instant.

function statusChainFor({ vendorMode, fulfilment, deliveryType }){
  const isFood = vendorMode === 'food';
  if(fulfilment === 'pickup'){
    return isFood
      ? ['ORDER PLACED','RESTAURANT ACCEPTED','PREPARING','READY FOR PICKUP','PICKED UP BY YOU']
      : ['ORDER PLACED','STORE ACCEPTED','PACKING','READY FOR PICKUP','PICKED UP BY YOU'];
  }
  const base = isFood
    ? ['ORDER PLACED','RESTAURANT ACCEPTED','PREPARING','READY','RIDER ASSIGNED','PICKED UP','OUT FOR DELIVERY','DELIVERED']
    : ['ORDER PLACED','STORE ACCEPTED','PACKING','READY','RIDER ASSIGNED','PICKED UP','OUT FOR DELIVERY','DELIVERED'];
  if(!isFood && deliveryType === 'scheduled') return ['SCHEDULED','PROCESSING', ...base.slice(1)];
  return base;
}

function isTerminalStatus(status){
  return status === 'DELIVERED' || status === 'PICKED UP BY YOU';
}

// Stage 10: the mock RIDER_POOL that used to live here is gone — order
// assignment now picks a real, active `Rider` account from the database
// (see routes/admin.js's /orders/:id/advance), since a rider needs an
// actual login to be the only one allowed to advance their own delivery.

// Rules-based cancellation charge (brief §16 — never a flat blanket
// percentage): 0% before preparation starts, 30% once it has, blocked
// entirely once a rider is assigned or a pickup order is ready.
function cancellationPolicyFor(order){
  if(order.cancelled || isTerminalStatus(order.status)){
    return { cancellable:false, reasonBlocked:'This order can no longer be cancelled.' };
  }
  const chain = order.statusChain;
  const idx = order.statusIndex;
  const prepIdx = chain.indexOf('PREPARING') !== -1 ? chain.indexOf('PREPARING') : chain.indexOf('PACKING');
  const riderIdx = chain.indexOf('RIDER ASSIGNED');
  const pickupReadyIdx = chain.indexOf('READY FOR PICKUP');

  if(riderIdx !== -1 && idx >= riderIdx){
    return { cancellable:false, reasonBlocked:'A rider has already been assigned to this order. Please contact support to cancel.' };
  }
  if(pickupReadyIdx !== -1 && idx >= pickupReadyIdx){
    return { cancellable:false, reasonBlocked:'This order is ready for pickup and can no longer be self-cancelled. Please contact support.' };
  }
  if(prepIdx !== -1 && idx >= prepIdx){
    return { cancellable:true, chargePct:0.3, reasonNote:'Preparation has already started, so a 30% cancellation charge applies to cover ingredient/prep cost.' };
  }
  return { cancellable:true, chargePct:0, reasonNote:"This order hasn't started preparation yet — full refund, no charge." };
}

module.exports = { statusChainFor, isTerminalStatus, cancellationPolicyFor };
