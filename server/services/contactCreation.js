const db=require('../db');
const F=require('./customFields');
const {canLinkUser}=require('./spaces');
const {assertWithinLimit,LimitExceededError}=require('./limits');
const VALID_STATUSES=['lead','contacted','negotiating','customer','lost'];
async function validateContactLinks(client,user,companyId,ownerId){
 if(companyId&&!(await client.query('SELECT id FROM companies WHERE id=$1 AND workspace_id=$2',[companyId,user.workspace_id])).rows.length)throw Object.assign(new Error('Company is not available in this workspace.'),{status:400});
 if(ownerId&&!await canLinkUser(client,ownerId,user.workspace_id))throw Object.assign(new Error('Owner is not available in this workspace.'),{status:400});
}
function buildFullName(first,last,fallback){return [(first||'').trim(),(last||'').trim()].filter(Boolean).join(' ')||(fallback||'').trim();}
async function createContact(user,payload,client=db){
  const {
    first_name, last_name, full_name, email, phone, company, marketing_theme, status, notes,
    owner_id, company_id, title, is_decision_maker,
    tags, secondary_email, secondary_phone, website, linkedin, instagram, facebook, twitter,
    city, country, state, postal_code, address, customer_type, priority, lead_source,
    department, preferred_language, telegram, internal_notes,
  } = payload || {};

  const derivedFullName = buildFullName(first_name, last_name, full_name);
  if (!derivedFullName) {
    throw Object.assign(new Error("First name is required."),{status:400});
  }

  try {
    await assertWithinLimit(user.workspace_id, "contacts",client);
  } catch (err) {
    if (err instanceof LimitExceededError) Object.assign(err,{status:403,code:"LIMIT_EXCEEDED"});
    throw err;
  }

  const finalStatus = VALID_STATUSES.includes(status) ? status : "lead";
  const firstName = (first_name || "").trim() || derivedFullName.split(" ")[0];
  const lastName = (last_name || "").trim() || (derivedFullName.includes(" ") ? derivedFullName.split(" ").slice(1).join(" ") : null);
  const normalizedTags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];

  await validateContactLinks(client,user,company_id,owner_id||user.id);
  const companyUnit=await require('../services/commercial').validateUnit(client,user.workspace_id,payload.company_unit_id,company_id);
  const custom=await F.validate(client,user.workspace_id,'contact',payload.custom_fields);
  const result = await client.query(
    `INSERT INTO contacts (
       workspace_id, full_name, first_name, last_name, email, phone, company, marketing_theme, status, notes,
       owner_id, company_id, title, is_decision_maker,
       tags, secondary_email, secondary_phone, website, linkedin, instagram, facebook, twitter,
       city, country, state, postal_code, address, customer_type, priority, lead_source,
       department, preferred_language, telegram, internal_notes, custom_fields, company_unit_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,$29,$30,
       $31,$32,$33,$34,$35,$36
     ) RETURNING *`,
    [
      user.workspace_id, derivedFullName, firstName||null, lastName||null,
      email?.trim()||null, phone?.trim()||null, company?.trim()||null,
      marketing_theme?.trim()||null, finalStatus, notes?.trim()||null,
      owner_id||user.id, company_id||null, title?.trim()||null, Boolean(is_decision_maker),
      normalizedTags,
      secondary_email?.trim()||null, secondary_phone?.trim()||null,
      website?.trim()||null, linkedin?.trim()||null, instagram?.trim()||null,
      facebook?.trim()||null, twitter?.trim()||null,
      city?.trim()||null, country?.trim()||null, state?.trim()||null,
      postal_code?.trim()||null, address?.trim()||null,
      customer_type?.trim()||null, priority?.trim()||"medium", lead_source?.trim()||null,
      department?.trim()||null, preferred_language?.trim()||null,
      telegram?.trim()||null, internal_notes?.trim()||null,JSON.stringify(custom),companyUnit,
    ]
  );

  const contact = result.rows[0];
  await client.query("INSERT INTO activity_log(workspace_id,contact_id,user_id,type,description) VALUES($1,$2,$3,'contact_created',$4)",[user.workspace_id,contact.id,user.id,`${user.name} added this contact.`]);
  return contact;
}
module.exports={createContact};
