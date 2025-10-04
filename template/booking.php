<?php
$subject = 'New Logistics Booking'; // Subject of your email
$to = 'contact@designesia.com';  // Recipient's E-mail

// Collect Shipper Information
$shipper_name    = $_POST['shipper_name'] ?? '';
$shipper_email   = $_POST['shipper_email'] ?? '';
$shipper_phone   = $_POST['shipper_phone'] ?? '';
$shipper_address = $_POST['shipper_address'] ?? '';

// Collect Receiver Information
$receiver_name    = $_POST['receiver_name'] ?? '';
$receiver_email   = $_POST['receiver_email'] ?? '';
$receiver_phone   = $_POST['receiver_phone'] ?? '';
$receiver_address = $_POST['receiver_address'] ?? '';

// Shipment Details
$goods_type   = $_POST['goods_type'] ?? '';
$package_type = $_POST['package_type'] ?? '';
$packages     = $_POST['packages'] ?? '';
$weight       = $_POST['weight'] ?? '';
$dimensions   = $_POST['dimensions'] ?? '';
$goods_value  = $_POST['goods_value'] ?? '';

// Logistics Options
$transport_mode  = $_POST['transport_mode'] ?? '';
$incoterms       = $_POST['incoterms'] ?? '';
$delivery_speed  = $_POST['delivery_speed'] ?? '';
$insurance       = $_POST['insurance'] ?? 'No';
$special         = isset($_POST['special']) ? implode(', ', $_POST['special']) : 'None';

// Schedule
$pickup_date       = $_POST['pickup_date'] ?? '';
$pickup_time       = $_POST['pickup_time'] ?? '';
$delivery_deadline = $_POST['delivery_deadline'] ?? '';

// Payment
$payment_method  = $_POST['payment_method'] ?? '';
$billing_address = $_POST['billing_address'] ?? '';

// Notes
$notes = $_POST['notes'] ?? '';

// Build Email
$email_from = $shipper_name . ' <' . $shipper_email . '>';

$headers  = "MIME-Version: 1.0\r\n";
$headers .= "Content-type: text/plain; charset=UTF-8\r\n";
$headers .= "From: ".$email_from."\r\n";
$headers .= "Reply-To: ".$shipper_email."\r\n";

// Format message
$message  = "=== Shipper Information ===\n";
$message .= "Name / Company: $shipper_name\n";
$message .= "Email: $shipper_email\n";
$message .= "Phone: $shipper_phone\n";
$message .= "Address: $shipper_address\n\n";

$message .= "=== Receiver Information ===\n";
$message .= "Name / Company: $receiver_name\n";
$message .= "Email: $receiver_email\n";
$message .= "Phone: $receiver_phone\n";
$message .= "Address: $receiver_address\n\n";

$message .= "=== Shipment Details ===\n";
$message .= "Type of Goods: $goods_type\n";
$message .= "Package Type: $package_type\n";
$message .= "Number of Packages: $packages\n";
$message .= "Weight: $weight kg\n";
$message .= "Dimensions: $dimensions\n";
$message .= "Value of Goods: $goods_value USD\n\n";

$message .= "=== Logistics Options ===\n";
$message .= "Mode of Transport: $transport_mode\n";
$message .= "Incoterms: $incoterms\n";
$message .= "Delivery Speed: $delivery_speed\n";
$message .= "Insurance: $insurance\n";
$message .= "Special Handling: $special\n\n";

$message .= "=== Schedule ===\n";
$message .= "Pickup Date: $pickup_date\n";
$message .= "Pickup Time: $pickup_time\n";
$message .= "Delivery Deadline: $delivery_deadline\n\n";

$message .= "=== Payment ===\n";
$message .= "Payment Method: $payment_method\n";
$message .= "Billing Address: $billing_address\n\n";

$message .= "=== Additional Notes ===\n";
$message .= "$notes\n";

// Send email
if (@mail($to, $subject, $message, $headers)) {
    echo 'sent';
} else {
    echo 'failed';
}
?>
