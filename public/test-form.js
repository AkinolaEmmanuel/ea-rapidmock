document.querySelector('form').addEventListener('input', event => {
  document.getElementById('events').textContent = `input: ${event.target.name || event.target.autocomplete} = ${event.target.value}`;
});
document.querySelector('form').addEventListener('submit', event => event.preventDefault());
