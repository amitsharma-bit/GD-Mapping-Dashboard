const BASE = 'https://api.hubapi.com';

function headers() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN is not set');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function searchCompanies(body) {
  const res = await fetch(`${BASE}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || `HubSpot search failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json.results || [];
}

export async function findCompanyByDomain(domain) {
  const results = await searchCompanies({
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
    properties: ['name', 'domain', 'dealership_group_name'],
    limit: 1,
  });
  return results[0] || null;
}

// Finds companies whose dealership_group_name contains any of the given name tokens,
// so "Auto West" matches a stored value like "Auto West Group".
export async function findGroupCandidates(candidateName) {
  const tokens = candidateName.split(' ').filter((t) => t.length > 2).slice(0, 3);
  if (!tokens.length) return [];
  const results = await searchCompanies({
    filterGroups: tokens.map((t) => ({
      filters: [{ propertyName: 'dealership_group_name', operator: 'CONTAINS_TOKEN', value: t }],
    })),
    properties: ['name', 'domain', 'dealership_group_name'],
    limit: 25,
  });
  return results;
}
