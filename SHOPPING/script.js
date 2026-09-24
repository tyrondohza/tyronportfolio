const cartItems = [];

const cartList = document.getElementById('cart-items');
const cartTotal = document.getElementById('cart-total');
const checkoutBtn = document.getElementById('checkout-btn');
const productCards = document.querySelectorAll('.product-card');

function updateProductAvailability() {
  productCards.forEach((card) => {
    const name = card.dataset.name;
    const stock = Number(card.dataset.stock);
    const availability = card.querySelector('.availability');
    const button = card.querySelector('.add-to-cart');

    if (stock <= 0) {
      availability.textContent = 'Available: 0 units';
      availability.className = 'availability';
      button.disabled = true;
      button.textContent = 'Sold Out';
      return;
    }

    if (stock <= 3) {
      availability.className = 'availability low-stock';
    } else {
      availability.className = 'availability in-stock';
    }

    availability.textContent = `Available: ${stock} units`;
    button.disabled = false;
    button.textContent = 'Add to cart';
  });
}

function updateCart() {
  cartList.innerHTML = '';

  if (cartItems.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-cart';
    empty.textContent = 'No items selected yet.';
    cartList.appendChild(empty);
    cartTotal.textContent = 'KSh 0';
    return;
  }

  let grandTotal = 0;

  cartItems.forEach((item, index) => {
    const listItem = document.createElement('li');
    const itemText = document.createElement('span');
    const removeBtn = document.createElement('button');

    itemText.textContent = `${item.name} - KSh ${item.price.toLocaleString()}`;
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'remove-item';
    removeBtn.addEventListener('click', () => removeFromCart(index));

    listItem.appendChild(itemText);
    listItem.appendChild(removeBtn);
    cartList.appendChild(listItem);
    grandTotal += item.price;
  });

  cartTotal.textContent = `KSh ${grandTotal.toLocaleString()}`;
}

function addToCart(name, price) {
  const productCard = [...productCards].find((card) => card.dataset.name === name);

  if (!productCard) return;

  const stock = Number(productCard.dataset.stock);
  if (stock <= 0) {
    return;
  }

  cartItems.push({ name, price });
  productCard.dataset.stock = String(stock - 1);
  updateProductAvailability();
  updateCart();
}

function removeFromCart(index) {
  const itemToRemove = cartItems[index];
  if (!itemToRemove) return;

  const productCard = [...productCards].find((card) => card.dataset.name === itemToRemove.name);
  if (productCard) {
    productCard.dataset.stock = String(Number(productCard.dataset.stock) + 1);
  }

  cartItems.splice(index, 1);
  updateProductAvailability();
  updateCart();
}

document.querySelectorAll('.add-to-cart').forEach((button) => {
  button.addEventListener('click', () => {
    const productCard = button.closest('.product-card');
    const name = productCard.dataset.name;
    const price = Number(productCard.dataset.price);
    addToCart(name, price);
  });
});

checkoutBtn.addEventListener('click', () => {
  if (cartItems.length === 0) {
    alert('Your cart is empty. Please add some items first.');
    return;
  }

  const itemNames = cartItems.map((item) => item.name).join(', ');
  const total = cartItems.reduce((sum, item) => sum + item.price, 0);

  alert(`Items selected: ${itemNames}\nTotal: KSh ${total.toLocaleString()}`);
});

updateProductAvailability();
updateCart();
