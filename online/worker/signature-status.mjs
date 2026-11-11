import {assert} from '../my-tech-accounting/model.mjs';
import {signatureIsConfigured,validateSignature,hydrateSignature} from './signature.mjs';

const signatureSnapshotCollections=['documents','receipts','payroll','bills'];
const signatureSnapshotMissing=record=>!record.company?.signature?.assetId;
function signatureUnsignedCounts(state){
  const counts={documents:0,receipts:0,payroll:0,bills:0,total:0};
  for(const collection of signatureSnapshotCollections){counts[collection]=(state[collection]||[]).filter(signatureSnapshotMissing).length;counts.total+=counts[collection];}
  return counts;
}

// Only the owner-facing route may expose this status; hydrate checks the private
// object as well as metadata so a missing or corrupt image is never shown as ready.
export async function signatureStatus(env,state){
  const status={configured:false,unsigned:signatureUnsignedCounts(state)};
  if(!signatureIsConfigured(state.company)){
    status.error=state.company?.signature?.assetId?'ข้อมูลไฟล์ลายเซ็นไม่ถูกต้อง กรุณาบันทึกลายเซ็นใหม่':'ยังไม่ได้บันทึกรูปลายเซ็น';return status;
  }
  try{validateSignature(state.company);await hydrateSignature(env,state.company);status.configured=true;}
  catch{status.error='ไม่สามารถเปิดไฟล์ลายเซ็นได้ กรุณาบันทึกลายเซ็นใหม่';}
  return status;
}

// Called only after an explicit owner action and successful status check. A record
// with any stored asset ID is immutable here, even if the referenced file is missing.
export function applyUnsignedSignatures(state,signature){
  assert(signatureIsConfigured({signature}),'กรุณาบันทึกรูปลายเซ็นก่อน');validateSignature({signature});
  const counts={documents:0,receipts:0,payroll:0,bills:0,total:0};
  for(const collection of signatureSnapshotCollections){
    for(const record of state[collection]||[]){
      if(!signatureSnapshotMissing(record))continue;
      const company=structuredClone(record.company||state.company||{});
      company.signature=structuredClone(signature);record.company=company;counts[collection]++;counts.total++;
    }
  }
  return counts;
}
