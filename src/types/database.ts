export type UserRole = 'admin' | 'counter';
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid';
export type PaymentMethod = 'cash' | 'transfer';
export type ModifierType = 'addon' | 'modification';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  active: boolean;
  sort_order: number;
  image_url: string | null;
  variant_prices: Partial<Record<BurgerMeatSize, number>>;
  created_at: string;
  updated_at: string;
}

export interface Modifier {
  id: string;
  name: string;
  price: number;
  type: ModifierType;
  active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: number;
  customer_name: string;
  pickup_time: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  closed_by: string | null;
  closed_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  subtotal: number;
  item_comment: string | null;
  item_config: OrderItemConfig | null;
  capacity_units: number;
  created_at: string;
}

export interface OrderItemModifier {
  id: string;
  order_item_id: string;
  modifier_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  type_snapshot: ModifierType;
}

export interface Payment {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount: number;
  received_amount: number | null;
  change_amount: number | null;
  subtotal_amount: number | null;
  discount_amount: number;
  discount_percent: number;
  received_by: string | null;
  created_at: string;
}

export interface CashRegister {
  id: string;
  business_date: string;
  opened_by: string | null;
  opening_amount: number;
  closed_by: string | null;
  closing_amount: number | null;
  closing_difference_amount: number | null;
  opened_at: string;
  closed_at: string | null;
}

export interface CashMovement {
  id: string;
  register_id: string;
  type: 'income' | 'expense';
  amount: number;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export type BurgerMeatSize = 'Simple' | 'Doble' | 'Triple';
export type BurgerProtein = 'carne' | 'veggie';
export type ExtraSeasoning = 'Sin sazon' | 'Sazonadas' | 'Sazonados';
export type DipChoice = 'Cheddar' | 'Alioli' | 'Barbacoa';

export type OrderItemConfig =
  | {
      kind: 'burger';
      meatSize: BurgerMeatSize;
      baseMeats: number;
      extraMeats: number;
      totalMeats: number;
      protein?: BurgerProtein;
    }
  | {
      kind: 'extra';
      seasoning?: ExtraSeasoning;
      dip?: DipChoice | null;
    }
  | {
      kind: 'dip';
    }
  | {
      kind: 'beverage';
    }
  | {
      kind: 'plain';
    };

// Payload que se envía al RPC create_order
export interface NewOrderItemPayload {
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  item_comment?: string | null;
  item_config?: OrderItemConfig;
  capacity_units?: number;
  modifiers: {
    modifier_id: string;
    name: string;
    price: number;
    type: ModifierType;
  }[];
}
