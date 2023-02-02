import { ProductLine, Invoice } from './types'

export const initialProductLine: ProductLine = {
  description: '',
  quantity: '1',
  rate: '0.00',
  discount: '0%'
  
}

export const initialInvoice: Invoice = {
  logo: '',
  logoWidth: 100,
  title: 'No. Factura',
  companyName: 'Ladiv Estudio Creativo SRL',
  companyRNC: '132612671',
  name: 'Leslie Medina',
  companyAddress: 'Calle Gaspar Polanco #280, Bella Vista',
  companyAddress2: 'Santo Domingo, DN',
  companyCountry: 'República Dominicana',
  billTo: 'Señor/(es): ',
  clientRNC:'',
  clientName: '',
  clientAddress: '',
  clientAddress2: '',
  clientCountry: 'República Dominicana',
  invoiceTitleLabel: 'NFC:',
  invoiceTitle: '',
  invoiceDateLabel: 'Fecha Exp:',
  invoiceDate: '',
  invoiceDueDateLabel: 'Fecha Venc:',
  invoiceDueDate: '',
  productLineDescription: 'Producto y/o servicio',
  productLineQuantity: 'Cant',
  productLineQuantityRate: 'Unidad',
  productLineQuantityAmount: 'Total',
  productLineDiscount: 'Discount',
  productLines: [
    {
      description: 'Brochure Design',
      quantity: '2',
      rate: '100.00',
      discount:'0%'
      
    },
    { ...initialProductLine },
    { ...initialProductLine },
  ],
  subTotalLabel: 'Sub Total',
  taxLabel: 'ITBIS (18%)',
  discLabel: 'Discount (0%)',
  totalLabel: 'TOTAL',
  currency: '$',
  notesLabel: 'Notes',
  notes: 'It was great doing business with you.',
  termLabel: 'Terms & Conditions',
  term: 'Please make the payment by the due date.',
}