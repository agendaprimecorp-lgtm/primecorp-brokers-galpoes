export async function simpleParser(src){ const s=String(src); return { subject: s.split('\n')[0].replace('Subject: ',''), text: s }; }
