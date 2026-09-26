// Seeds the database with the SAME vendors/products/coupons/delivery
// slabs already hardcoded in tiffin-app.html's mock Services layer — same
// ids, same names, same prices — so pointing the frontend at this real
// backend (Stage-by-stage, per Services.* method) doesn't require
// touching any product/vendor id used in the UI.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

// Stage 10: demo vendor-staff/rider logins so the real ops auth
// (POST /staff/auth/vendor-login, /staff/auth/rider-login) is testable
// out of the box, the same way the OTP dev-mode code is. These are
// obviously not production credentials — the seed only ever runs
// against your own dev/staging database.
const VENDOR_STAFF = [
  { phone:'9000000001', name:'Home Kitchen Staff', vendorId:'v_hk', password:'homekitchen123' },
  { phone:'9000000002', name:'Punjabi Rasoi Staff', vendorId:'v_pr', password:'punjabirasoi123' }
];
const RIDERS = [
  { phone:'9000000101', name:'Ravi Kumar', vehicle:'Bike', plate:'DL 5S 4432', password:'rider123' },
  { phone:'9000000102', name:'Suman Yadav', vehicle:'Scooter', plate:'BR 01 AB 7781', password:'rider123' }
];

const VENDORS = [
  { id:'v_hk', mode:'food', name:'Home Kitchen', emoji:'🍱', tags:['Tiffin','Fast Food','North Indian'], rating:4.6, distanceKm:1.2, etaMin:20, etaMax:30, isOpen:true, offer:'20% OFF up to ₹60' },
  { id:'v_pr', mode:'food', name:'Punjabi Rasoi', emoji:'🍗', tags:['Tiffin','North Indian'], rating:4.8, distanceKm:2.4, etaMin:25, etaMax:35, isOpen:true, offer:'Free delivery above ₹199' },
  { id:'v_dc', mode:'food', name:'Delhi Chaat Co.', emoji:'🥙', tags:['Fast Food'], rating:4.5, distanceKm:0.8, etaMin:15, etaMax:25, isOpen:false, offer:null },
  { id:'v_sw', mode:'food', name:'Sundar Sweets', emoji:'🍮', tags:['Desserts'], rating:4.7, distanceKm:3.1, etaMin:30, etaMax:40, isOpen:true, offer:'10% OFF' },
  { id:'v_fm', mode:'grocery', name:'Fresh Mart', emoji:'🥬', tags:['Bread','Dairy'], rating:4.4, distanceKm:1.0, etaMin:15, etaMax:20, isOpen:true, offer:'₹50 OFF above ₹499' },
  { id:'v_dg', mode:'grocery', name:'Daily Greens', emoji:'🥦', tags:['Fruits','Vegetables'], rating:4.5, distanceKm:1.7, etaMin:20, etaMax:30, isOpen:true, offer:null },
  { id:'v_qb', mode:'grocery', name:'QuickBasket', emoji:'🧺', tags:['Bread','Fruits','Vegetables','Dairy'], rating:4.3, distanceKm:2.5, etaMin:10, etaMax:15, isOpen:true, offer:'Instant delivery' }
];

const PRODUCTS = [
  {id:'p1', mode:'food', vendorId:'v_hk', category:'Tiffin', name:'Dal Do Pyaza', price:109, emoji:'🍛', offLabel:'20% off', desc:'Home-style dal tempered with onions, served with steamed rice.', stock:'in', addons:[{name:'Extra roti',price:15},{name:'Papad',price:10},{name:'Pickle',price:5}]},
  {id:'p2', mode:'food', vendorId:'v_hk', category:'Tiffin', name:'Rajma Chawal', price:119, emoji:'🍚', desc:'Slow-cooked kidney bean curry with steamed basmati rice.', stock:'in', addons:[{name:'Extra roti',price:15},{name:'Papad',price:10}]},
  {id:'p3', mode:'food', vendorId:'v_hk', category:'Tiffin', name:'Roti Sabzi Set', price:99, emoji:'🫓', desc:'Four tawa rotis with a seasonal vegetable curry.', stock:'low', addons:[{name:'Extra roti',price:15}]},
  {id:'p4', mode:'food', vendorId:'v_pr', category:'Tiffin', name:'Paneer Thali', price:149, emoji:'🍛', desc:'Paneer butter masala, dal, rice, roti and salad.', stock:'in', addons:[{name:'Extra paneer',price:40}]},
  {id:'p5', mode:'food', vendorId:'v_dc', category:'Fast Food', name:'Aloo Tikki Burger', price:99, emoji:'🍔', offLabel:'30% off', desc:'Crispy potato patty burger with mint chutney.', stock:'in', addons:[{name:'Extra cheese',price:20},{name:'Add fries',price:49}]},
  {id:'p6', mode:'food', vendorId:'v_dc', category:'Fast Food', name:'Masala Fries', price:79, emoji:'🍟', desc:'Crispy fries tossed in tangy chaat masala.', stock:'in'},
  {id:'p7', mode:'food', vendorId:'v_dc', category:'Fast Food', name:'Veg Frankie Roll', price:89, emoji:'🌯', desc:'Rolled paratha with spiced vegetables and chutney.', stock:'out'},
  {id:'p8', mode:'food', vendorId:'v_hk', category:'Fast Food', name:'Pav Bhaji', price:119, emoji:'🍲', desc:'Buttery mashed vegetable curry with toasted pav.', stock:'in'},
  {id:'p9', mode:'food', vendorId:'v_pr', category:'North Indian', name:'Chole Bhature', price:129, emoji:'🍛', desc:'Spiced chickpea curry with fluffy fried bread.', stock:'in'},
  {id:'p10', mode:'food', vendorId:'v_pr', category:'North Indian', name:'Amritsari Kulcha', price:109, emoji:'🫓', desc:'Stuffed kulcha with butter, served with chole.', stock:'in'},
  {id:'p11', mode:'food', vendorId:'v_pr', category:'North Indian', name:'Butter Chicken', price:229, emoji:'🍗', desc:'Creamy tomato-butter chicken curry.', stock:'in', addons:[{name:'Extra gravy',price:35},{name:'Butter naan',price:40}]},
  {id:'p12', mode:'food', vendorId:'v_hk', category:'North Indian', name:'Tandoori Roti Set', price:69, emoji:'🫓', desc:'Four tandoori rotis with dal tadka.', stock:'in'},
  {id:'p13', mode:'food', vendorId:'v_sw', category:'Desserts', name:'Gulab Jamun', price:69, emoji:'🍮', offLabel:'10% off', desc:'Soft milk dumplings soaked in rose syrup.', stock:'in'},
  {id:'p14', mode:'food', vendorId:'v_sw', category:'Desserts', name:'Rasmalai', price:99, emoji:'🍮', desc:'Cottage-cheese discs in sweetened saffron milk.', stock:'in'},
  {id:'p15', mode:'food', vendorId:'v_sw', category:'Desserts', name:'Kaju Katli', price:149, emoji:'🍬', desc:'Diamond-cut cashew fudge with silver leaf.', stock:'low'},
  {id:'p16', mode:'food', vendorId:'v_sw', category:'Desserts', name:'Gajar Halwa', price:89, emoji:'🥕', desc:'Slow-cooked carrot pudding with ghee and nuts.', stock:'in'},
  {id:'g1', mode:'grocery', vendorId:'v_fm', category:'Bread', name:'Agege Bread', price:80.99, emoji:'🥐', offLabel:'10% off', desc:'Soft, lightly sweet West-African style loaf.', stock:'in'},
  {id:'g2', mode:'grocery', vendorId:'v_fm', category:'Bread', name:'Toast Bread', price:45.99, emoji:'🍞', desc:'Everyday sandwich bread, sliced.', stock:'in'},
  {id:'g3', mode:'grocery', vendorId:'v_qb', category:'Bread', name:'Multigrain Bread', price:52.99, emoji:'🥖', desc:'Whole-grain loaf with seeds.', stock:'in'},
  {id:'g4', mode:'grocery', vendorId:'v_qb', category:'Bread', name:'Wheat Bread', price:16.99, emoji:'🍞', desc:'Soft whole-wheat sandwich bread.', stock:'low'},
  {id:'g5', mode:'grocery', vendorId:'v_dg', category:'Fruits', name:'Red Apples', price:99.00, emoji:'🍎', desc:'Crisp, hand-picked red apples (1 kg).', stock:'in'},
  {id:'g6', mode:'grocery', vendorId:'v_dg', category:'Fruits', name:'Bananas', price:39.00, emoji:'🍌', desc:'Farm-fresh bananas (dozen).', stock:'in'},
  {id:'g7', mode:'grocery', vendorId:'v_qb', category:'Fruits', name:'Oranges', price:69.00, emoji:'🍊', desc:'Juicy oranges (1 kg).', stock:'in'},
  {id:'g8', mode:'grocery', vendorId:'v_dg', category:'Fruits', name:'Grapes', price:129.00, emoji:'🍇', offLabel:'15% off', desc:'Seedless green grapes (500 g).', stock:'out'},
  {id:'g9', mode:'grocery', vendorId:'v_dg', category:'Vegetables', name:'Broccoli', price:59.00, emoji:'🥦', desc:'Fresh broccoli florets (500 g).', stock:'in'},
  {id:'g10', mode:'grocery', vendorId:'v_dg', category:'Vegetables', name:'Carrots', price:29.00, emoji:'🥕', desc:'Crunchy carrots (500 g).', stock:'in'},
  {id:'g11', mode:'grocery', vendorId:'v_qb', category:'Vegetables', name:'Tomatoes', price:35.00, emoji:'🍅', desc:'Ripe, juicy tomatoes (1 kg).', stock:'in'},
  {id:'g12', mode:'grocery', vendorId:'v_qb', category:'Vegetables', name:'Onions', price:28.00, emoji:'🧅', desc:'Fresh onions (1 kg).', stock:'low'},
  {id:'g13', mode:'grocery', vendorId:'v_fm', category:'Dairy', name:'Cheddar Cheese', price:149.00, emoji:'🧀', desc:'Aged cheddar block (200 g).', stock:'in'},
  {id:'g14', mode:'grocery', vendorId:'v_fm', category:'Dairy', name:'Farm Milk', price:58.00, emoji:'🥛', desc:'Fresh full-cream milk (1 L).', stock:'in'},
  {id:'g15', mode:'grocery', vendorId:'v_qb', category:'Dairy', name:'Butter', price:89.00, emoji:'🧈', desc:'Salted table butter (200 g).', stock:'in'},
  {id:'g16', mode:'grocery', vendorId:'v_fm', category:'Dairy', name:'Yoghurt', price:42.00, emoji:'🍦', desc:'Thick set curd (400 g).', stock:'in'}
];

// Same slabs as the frontend's Services.DeliveryPricing mock, now
// actually configurable — edit these rows (or the DeliverySlab table
// directly) rather than hardcoding a fee anywhere in code.
const DELIVERY_SLABS = [
  { maxKm:1, fee:10, sortOrder:0 },
  { maxKm:2, fee:20, sortOrder:1 },
  { maxKm:4, fee:30, sortOrder:2 },
  { maxKm:6, fee:40, sortOrder:3 },
  { maxKm:999, fee:55, sortOrder:4 } // "and above"
];

const COUPONS = [
  { code:'FIRST30', type:'percent', value:30, minOrder:0,   maxDiscount:100, mode:'food',    desc:'30% off your first tiffin order (up to ₹100)' },
  { code:'TIFFIN20', type:'percent', value:20, minOrder:150, maxDiscount:60,  mode:'food',    desc:'20% off orders above ₹150 (up to ₹60)' },
  { code:'FRESH50', type:'flat',    value:50, minOrder:499, maxDiscount:50,  mode:'grocery', desc:'₹50 off grocery orders above ₹499' }
];

async function main(){
  for(const v of VENDORS){
    await prisma.vendor.upsert({ where:{ id:v.id }, update:v, create:v });
  }
  for(const p of PRODUCTS){
    await prisma.product.upsert({ where:{ id:p.id }, update:p, create:p });
  }
  await prisma.deliverySlab.deleteMany({});
  await prisma.deliverySlab.createMany({ data: DELIVERY_SLABS });
  for(const c of COUPONS){
    await prisma.coupon.upsert({ where:{ code:c.code }, update:c, create:c });
  }

  // A couple of demo flash offers (brief §19) so GET /flash-offers has
  // something to return out of the box — real ones are created via
  // POST /admin/flash-offers.
  const now = new Date();
  await prisma.flashOffer.deleteMany({});
  await prisma.flashOffer.createMany({
    data: [
      { vendorId:'v_sw', itemName:'Gulab Jamun (6 pc box)', originalPrice:99, offerPrice:59, quantity:8, startsAt:now, expiresAt:new Date(now.getTime()+10*60*1000) },
      { vendorId:'v_dg', itemName:'Bananas (dozen)', originalPrice:39, offerPrice:25, quantity:15, startsAt:now, expiresAt:new Date(now.getTime()+10*60*1000) }
    ]
  });

  for(const s of VENDOR_STAFF){
    const passwordHash = await bcrypt.hash(s.password, 12);
    await prisma.vendorStaff.upsert({
      where: { phone: s.phone },
      update: { name: s.name, vendorId: s.vendorId, passwordHash },
      create: { phone: s.phone, name: s.name, vendorId: s.vendorId, passwordHash }
    });
  }
  for(const r of RIDERS){
    const passwordHash = await bcrypt.hash(r.password, 12);
    await prisma.rider.upsert({
      where: { phone: r.phone },
      update: { name: r.name, vehicle: r.vehicle, plate: r.plate, passwordHash },
      create: { phone: r.phone, name: r.name, vehicle: r.vehicle, plate: r.plate, passwordHash }
    });
  }

  console.log(`Seeded ${VENDORS.length} vendors, ${PRODUCTS.length} products, ${DELIVERY_SLABS.length} delivery slabs, ${COUPONS.length} coupons, 2 flash offers, ${VENDOR_STAFF.length} vendor-staff logins, ${RIDERS.length} rider logins.`);
  console.log('Demo vendor-staff logins (phone / password):', VENDOR_STAFF.map(s => `${s.phone} / ${s.password}`).join(', '));
  console.log('Demo rider logins (phone / password):', RIDERS.map(r => `${r.phone} / ${r.password}`).join(', '));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
