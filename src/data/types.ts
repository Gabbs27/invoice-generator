import { CSSProperties } from 'react'

export interface ProductLine {
  description: string
  quantity: string
  rate: string
  discount: string
}

export interface Invoice {
  logo: string
  logoWidth: number
  title: string
  companyName: string
  companyRNC: string
  name: string
  companyAddress: string
  companyAddress2: string
  companyCountry: string

  billTo: string
  clientRNC: string
  clientName: string
  clientAddress: string
  clientAddress2: string
  clientCountry: string

  invoiceTitleLabel: string
  invoiceTitle: string
  invoiceDateLabel: string
  invoiceDate: string
  invoiceDueDateLabel: string
  invoiceDueDate: string

  productLineDescription: string
  productLineQuantity: string
  productLineQuantityRate: string
  productLineQuantityAmount: string
  productLineDiscount: string
  productLines: ProductLine[]

  subTotalLabel: string
  taxLabel: string
  discLabel: string

  totalLabel: string
  currency: string

  notesLabel: string
  notes: string
  termLabel: string
  term: string
}

export interface CSSClasses {
  [key: string]: CSSProperties
}