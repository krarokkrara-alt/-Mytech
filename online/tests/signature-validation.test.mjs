import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSignatureBytes,signatureIsConfigured,signatureCompanies,signatureReferences,prepareSignatureRestore,validateSignatureBackup} from '../worker/signature.mjs';
import {signatureStatus,applyUnsignedSignatures} from '../worker/signature-status.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==','base64');
const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');
const validId='11111111-1111-4111-8111-111111111111';
const company=()=>({name:'MY TECH',signature:{assetId:validId,mime:'image/png',name:'Owner',title:'Director'}});

test('accepts complete small PNG, JPEG, and WebP signatures',()=>{
  for(const [bytes,mime] of [[png,'image/png'],[jpeg,'image/jpeg'],[webp,'image/webp']])assert.doesNotThrow(()=>validateSignatureBytes(bytes,mime));
});

test('rejects magic-byte forgeries, truncated images, mismatched types and extra data',()=>{
  for(const [bytes,mime] of [[Buffer.from([137,80,78,71]),'image/png'],[Buffer.from([255,216,255]),'image/jpeg'],[Buffer.from('RIFF0000WEBP'),'image/webp'],[png,'image/jpeg'],[jpeg,'image/webp'],[webp,'image/png']])assert.throws(()=>validateSignatureBytes(bytes,mime));
  for(const [bytes,mime] of [[png,'image/png'],[jpeg,'image/jpeg'],[webp,'image/webp']]){
    for(const cut of [1,4,Math.floor(bytes.length/2)])assert.throws(()=>validateSignatureBytes(bytes.subarray(0,bytes.length-cut),mime));
    assert.throws(()=>validateSignatureBytes(Buffer.concat([bytes,Buffer.from([0])]),mime));
  }
});

test('rejects oversized payloads, unsupported formats and unsafe dimensions',()=>{
  assert.throws(()=>validateSignatureBytes(Buffer.alloc(512*1024+1),'image/png'));
  assert.throws(()=>validateSignatureBytes(Buffer.from('<svg/>'),'image/svg+xml'));
  assert.throws(()=>validateSignatureBytes(Buffer.alloc(0),'image/png'));
  assert.throws(()=>validateSignatureBytes([137,80,78,71],'image/png'));
  const large=Buffer.from(png);large.writeUInt32BE(8193,16);assert.throws(()=>validateSignatureBytes(large,'image/png'));
  const excessivePixels=Buffer.from(png);excessivePixels.writeUInt32BE(8192,16);excessivePixels.writeUInt32BE(8192,20);assert.throws(()=>validateSignatureBytes(excessivePixels,'image/png'));
  const zero=Buffer.from(png);zero.writeUInt32BE(0,20);assert.throws(()=>validateSignatureBytes(zero,'image/png'));
});

test('rejects structurally invalid image sections',()=>{
  const badPng=Buffer.from(png);badPng.writeUInt32BE(0xffffffff,33);assert.throws(()=>validateSignatureBytes(badPng,'image/png'));
  const badPngDepth=Buffer.from(png);badPngDepth[24]=3;assert.throws(()=>validateSignatureBytes(badPngDepth,'image/png'));
  const noPngData=Buffer.concat([png.subarray(0,33),png.subarray(56)]);assert.throws(()=>validateSignatureBytes(noPngData,'image/png'));
  const jpegHeader=jpeg.subarray(0,jpeg.indexOf(Buffer.from([255,218])));assert.throws(()=>validateSignatureBytes(Buffer.concat([jpegHeader,Buffer.from([255,217])]),'image/jpeg'));
  const badJpegSegment=Buffer.from(jpeg);badJpegSegment[4]=255;badJpegSegment[5]=255;assert.throws(()=>validateSignatureBytes(badJpegSegment,'image/jpeg'));
  const badWebpLength=Buffer.from(webp);badWebpLength.writeUInt32LE(10000,16);assert.throws(()=>validateSignatureBytes(badWebpLength,'image/webp'));
  const noWebpFrame=Buffer.from(webp);noWebpFrame.write('JUNK',12,'ascii');assert.throws(()=>validateSignatureBytes(noWebpFrame,'image/webp'));
});

test('configured signature requires canonical stored asset metadata',()=>{
  assert.equal(signatureIsConfigured(company()),true);
  for(const value of [undefined,{}, {signature:{}},{signature:{image:'data:image/png;base64,abc'}},{signature:{assetId:'-'.repeat(36),mime:'image/png'}},{signature:{assetId:validId,mime:'image/svg+xml'}}])assert.equal(signatureIsConfigured(value),false);
});

test('supplier bill snapshots participate in private signature backup and restore',()=>{
  const state={company:{name:'Current'},bills:[{id:'bill',company:company()}]};
  assert.equal(signatureCompanies(state).length,2);assert.deepEqual(signatureReferences(state),[{id:validId,mime:'image/png'}]);
  assert.throws(()=>validateSignatureBackup({state,signatureFiles:[]}));
  assert.doesNotThrow(()=>validateSignatureBackup({state,signatureFiles:[{id:validId,mime:'image/png'}]}));
  const restored=prepareSignatureRestore(state,[{id:validId,mime:'image/png'}]);
  assert.notEqual(restored.state.bills[0].company.signature.assetId,validId);assert.equal(state.bills[0].company.signature.assetId,validId);
  assert.equal(restored.state.bills[0].company.signature.assetId,restored.files[0].id);
});

test('signature readiness verifies the private image, with unsigned counts in every document collection',async()=>{
  const state={company:company(),documents:[{company:company()},{}],receipts:[{}],payroll:[{}],bills:[{}]};
  const expected={documents:1,receipts:1,payroll:1,bills:1,total:4};
  const ready=await signatureStatus({BUCKET:{get:async()=>({arrayBuffer:async()=>png})}},state);
  assert.equal(ready.configured,true);assert.deepEqual(ready.unsigned,expected);
  for(const file of [null,{arrayBuffer:async()=>Buffer.from([137,80,78,71])}]){
    const bad=await signatureStatus({BUCKET:{get:async()=>file}},state);assert.equal(bad.configured,false);assert.ok(bad.error);assert.deepEqual(bad.unsigned,expected);
  }
  const missing=await signatureStatus({},{});assert.equal(missing.configured,false);assert.equal(missing.unsigned.total,0);
});

test('explicit unsigned application preserves old signatures and company snapshots',()=>{
  const signed=company();signed.signature.name='Historical signer';const signedBefore=structuredClone(signed);
  const damaged=company();damaged.signature.assetId='unavailable';const damagedBefore=structuredClone(damaged);
  const state={company:company(),documents:[{company:signed},{company:{name:'Historical company',signature:{name:'Typed only',title:''}}}],receipts:[{}],payroll:[{company:damaged},{}],bills:[{}]};
  const applied=applyUnsignedSignatures(state,state.company.signature);
  assert.deepEqual(applied,{documents:1,receipts:1,payroll:1,bills:1,total:4});
  assert.deepEqual(signed,signedBefore);assert.deepEqual(damaged,damagedBefore);
  assert.equal(state.documents[1].company.name,'Historical company');assert.equal(state.documents[1].company.signature.name,'Owner');
  state.company.signature.name='Changed default';assert.equal(state.receipts[0].company.signature.name,'Owner');
  assert.equal(applyUnsignedSignatures(state,state.company.signature).total,0);
  assert.throws(()=>applyUnsignedSignatures(state,{name:'No image',title:''}));
});
