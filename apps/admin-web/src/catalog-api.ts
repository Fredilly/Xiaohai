import { adminProductInputSchema, adminProductListResponseSchema, adminProductSchema, type AdminProductInput } from '@xiaohai/contracts/commerce';
const base=import.meta.env.VITE_API_BASE_URL??'http://127.0.0.1:3000';
export class CatalogApiError extends Error{constructor(readonly status:number){super(`Catalog API ${status}`);}}
async function call(path:string,token:string,method='GET',body?:object){const r=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new CatalogApiError(r.status);return r.json();}
export const listAdminProducts=async(token:string,q='')=>adminProductListResponseSchema.parse(await call(`/api/v1/staff/catalog/products${q?`?q=${encodeURIComponent(q)}`:''}`,token));
export const createAdminProduct=async(token:string,input:AdminProductInput)=>adminProductSchema.parse(await call('/api/v1/staff/catalog/products',token,'POST',adminProductInputSchema.parse(input)));
export const updateAdminProduct=async(token:string,id:string,input:AdminProductInput)=>adminProductSchema.parse(await call(`/api/v1/staff/catalog/products/${id}`,token,'PUT',adminProductInputSchema.parse(input)));
