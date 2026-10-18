const test=require('node:test'),assert=require('node:assert/strict');
test('signup checkout collects a payment method, starts exactly seven days, and does not repeat a consumed trial',async()=>{
 process.env.STRIPE_SECRET_KEY='sk_test_fixture';const key=require.resolve('stripe'),old=require.cache[key],calls=[];
 const mockClient = {
   prices: {retrieve: async()=>({currency:'usd',unit_amount:2900,recurring:{interval:'month',interval_count:1}})},
   checkout: {sessions: {create: async(...args)=>{calls.push(args);return{id:'cs_fixture',url:'https://checkout.stripe.test'};}}}
 };
 require.cache[key]={id:key,filename:key,loaded:true,exports:class {constructor(){return mockClient;}}};

 const service=require('../server/services/stripe');
 try{
  await service.createCheckoutSession({id:1,onboarding_payment_required:true,trial_used:false},'price_plus','plus','subscription','https://example.test/success','https://example.test/cancel');
  const request=calls[0][0];assert.equal(request.mode,'subscription');assert.equal(request.payment_method_collection,'always');assert.equal(request.subscription_data.trial_period_days,7);assert.equal(request.subscription_data.metadata.workspace_id,'1');assert.deepEqual(request.line_items,[{price:'price_plus',quantity:1}]);
  await service.createCheckoutSession({id:1,onboarding_payment_required:true,trial_used:true},'price_plus','plus','subscription','https://example.test/success','https://example.test/cancel');assert.equal(calls[1][0].subscription_data.trial_period_days,undefined);
  await service.createCheckoutSession({id:2},'price_plus','plus','subscription','https://example.test/success','https://example.test/cancel');assert.equal(calls[2][0].subscription_data.trial_period_days,undefined,'Existing paid upgrades do not reset trial');
 }finally{if(old)require.cache[key]=old;else delete require.cache[key];}
});
