import{describe,it}from"node:test";import assert from"node:assert/strict";import{parseShelfLifeQueueMessage,shelfLifeProcessBody}from"../src/message.js";import{resolveShelfLifeCategory}from"../src/category.js";
describe("worker-shelf-life queue contract",()=>{
it("rejects malformed messages",()=>{assert.equal(parseShelfLifeQueueMessage("{bad"),null);assert.equal(parseShelfLifeQueueMessage("1"),null)});
it("maps required fields to the service internal contract",()=>{const x=parseShelfLifeQueueMessage(JSON.stringify({data:{predictionId:"p1",itemId:"i1",productId:"p2",storage:"FRIDGE",opened:true,category:"dairy"}}));assert.equal(x?.data?.predictionId,"p1");assert.deepEqual(shelfLifeProcessBody(x!.data!),{itemId:"i1",productId:"p2",storedAt:"FRIDGE",opened:true,category:"dairy"})});
it("defaults opened to false and omits empty category",()=>{assert.deepEqual(shelfLifeProcessBody({itemId:"i1",productId:"p1"}),{itemId:"i1",productId:"p1",storedAt:undefined,opened:false})});
it("classifies canned tuna as shelf-stable even when OFF says fresh-meat-fish",()=>{
  assert.equal(resolveShelfLifeCategory({
    category:"fresh-meat-fish",
    name:"Tonno all'olio di oliva",
    openFoodFacts:{
      packaging:["en:cans","en:metal"],
      categoriesTags:["en:fish-and-seafood","en:fresh-meat-fish"],
      labelsTags:["en:canned-foods"],
    },
  }),"canned-preserved");
});
it("keeps fresh fish as fresh-meat-fish without preservation evidence",()=>{
  assert.equal(resolveShelfLifeCategory({
    category:"fresh-meat-fish",
    name:"Filetto di tonno fresco",
    openFoodFacts:{categoriesTags:["en:fresh-meat-fish"]},
  }),"fresh-meat-fish");
});
it("classifies frozen products from preservation evidence",()=>{
  assert.equal(resolveShelfLifeCategory({
    category:"fresh-meat-fish",
    name:"Tonno surgelato",
    openFoodFacts:{labelsTags:["en:frozen-foods"]},
  }),"frozen-general");
});
});