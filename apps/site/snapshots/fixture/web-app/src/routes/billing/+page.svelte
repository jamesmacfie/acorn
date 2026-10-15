<script>
  let { data } = $props()
</script>

<h1>Billing</h1>
<ul>
  {#each data.invoices as invoice}
    <li>{invoice.number} · {invoice.total}</li>
  {/each}
</ul>
