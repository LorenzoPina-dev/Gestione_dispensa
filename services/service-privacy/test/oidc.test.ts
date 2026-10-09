import{describe,it}from"node:test";
import assert from"node:assert/strict";
import{OidcTokenVerifier}from"../src/identity/oidc.js";

describe("OIDC bootstrap",()=>{
  it("uses an explicit JWKS URL without discovery",async()=>{
    let calls=0;
    const verifier=await OidcTokenVerifier.fromIssuer(
      "https://issuer.example/realms/test",
      "account",
      async()=>{calls+=1;throw new Error("discovery must not be called");},
      {jwksUrl:"https://jwks.example/keys"},
    );
    assert.ok(verifier);
    assert.equal(calls,0);
  });

  it("requires discovery when no JWKS override is provided",async()=>{
    let calls=0;
    await assert.rejects(
      ()=>OidcTokenVerifier.fromIssuer(
        "https://issuer.example/realms/test",
        "account",
        async()=>{calls+=1;return new Response(JSON.stringify({issuer:"https://other.example",jwks_uri:"https://jwks.example/keys"}),{status:200,headers:{"content-type":"application/json"}});},
      ),
      /OIDC discovery document is invalid/,
    );
    assert.equal(calls,1);
  });
});
