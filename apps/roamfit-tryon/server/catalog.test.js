import { describe,expect,it } from 'vitest'
import { scoreProduct } from './catalog.js'

describe('catalog ranking',()=>{
  it('prefers destination-relevant products',()=>{
    expect(scoreProduct({title:'Linen Resort Shirt',tags:['summer']},'coastal-linen','amalfi')).toBeGreaterThan(scoreProduct({title:'Wool Office Blazer'},'coastal-linen','amalfi'))
  })
})
