$(document).ready(function(){
    $('#logistics_booking_form').on('submit', function(e){
        e.preventDefault(); // Stop default submission

        var error = false;

        // Grab values
        var shipper_name  = $('#shipper_name').val().trim();
        var shipper_email = $('#shipper_email').val().trim();
        var shipper_phone = $('#shipper_phone').val().trim();

        // Reset errors on click
        $('#shipper_name,#shipper_email,#shipper_phone').on('click', function(){
            $(this).removeClass("error_input");
        });

        // Validation
        if(shipper_name.length === 0){
            error = true;
            $('#shipper_name').addClass("error_input");
        }

        if(shipper_email.length === 0 || shipper_email.indexOf('@') === -1){
            error = true;
            $('#shipper_email').addClass("error_input");
        }

        if(shipper_phone.length === 0){
            error = true;
            $('#shipper_phone').addClass("error_input");
        }

        // If no error, submit via AJAX
        if(error === false){
            var submitBtn = $(this).find('button[type="submit"]');
            submitBtn.attr({'disabled' : true}).text('Sending...');

            $.post("booking.php", $(this).serialize(), function(result){
                if(result === 'sent'){
                    submitBtn.text('Success');
                    $('#success_message').fadeIn(500);
                } else {
                    $('#error_message').fadeIn(500);
                    submitBtn.removeAttr('disabled').text('Book Shipment');
                }
            });
        }
    });
});
