import React from 'react'
import InvoicePage from './components/InvoicePage'
import { Invoice } from './data/types'

function App() {
  const savedInvoice = window.localStorage.getItem('invoiceData')
  let data ;

  try {
    if (savedInvoice) {
      data = JSON.parse(savedInvoice)
    }
  } catch (_e) { }

  const onInvoiceUpdated = (invoice: Invoice) => {
    window.localStorage.setItem('invoiceData', JSON.stringify(invoice))
  }

  return (
    <div className="app">
      {/* <h1 className="center fs-30">Generador de factura fiscal</h1> */}
      <InvoicePage data={data} onChange={onInvoiceUpdated} />
    </div>
  )
}

export default App