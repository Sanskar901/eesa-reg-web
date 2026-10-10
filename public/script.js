function showRegistration() {
    const section = document.getElementById("registration");

    section.classList.remove("hidden");
    section.scrollIntoView({ behavior: "smooth" });
}

const form = document.getElementById("registrationForm");
const message = document.getElementById("message");

form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    message.textContent = "Creating your registration...";

    try {
        // 1. Send student details to the server
        const student = {
            name: document.getElementById("name").value.trim(),
            collegeId: document.getElementById("collegeId").value.trim(),
            department: document.getElementById("department").value,
            year: document.getElementById("year").value,
            mobile: document.getElementById("mobile").value.trim()
        };

        const orderResponse = await fetch("/api/create-order", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(student)
        });

        const order = await orderResponse.json();

        if (!orderResponse.ok) {
            throw new Error(order.error || "Could not create payment order.");
        }

        // 2. Open Razorpay Checkout
        const options = {
            key: order.keyId,
            amount: order.amount,
            currency: order.currency,
            name: "EESA",
            description: "Freshers Party Registration",
            order_id: order.orderId,

            prefill: {
                name: student.name,
                contact: student.mobile
            },

            theme: {
                color: "#477eff"
            },

            handler: async function (paymentResponse) {
                message.textContent = "Verifying payment...";

                try {
                    // 3. Verify payment on the server
                    const verifyResponse = await fetch(
                        "/api/verify-payment",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(paymentResponse)
                        }
                    );

                    const result = await verifyResponse.json();

                    if (!verifyResponse.ok || !result.success) {
                        throw new Error(
                            result.message || "Payment verification failed."
                        );
                    }

                    // 4. Display the verified registration and QR
                    displayQRCode(result);

                } catch (error) {
                    message.textContent = error.message;
                } finally {
                    button.disabled = false;
                }
            },

            modal: {
                ondismiss: function () {
                    message.textContent =
                        "Payment window closed. Your registration is pending payment.";
                    button.disabled = false;
                }
            }
        };

        const checkout = new Razorpay(options);

        checkout.on("payment.failed", function () {
            message.textContent =
                "Payment failed. Please try again.";
            button.disabled = false;
        });

        checkout.open();

    } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
    }
});

function displayQRCode(result) {
    let section = document.getElementById("qrResult");

    if (!section) {
        section = document.createElement("section");
        section.id = "qrResult";
        section.className = "registration";

        document.querySelector("main").appendChild(section);
    }

    section.innerHTML = `
        <h2>Registration Confirmed!</h2>

        <p>Your payment has been verified.</p>

        <p>
            <strong>Registration ID:</strong>
            <span id="registrationId"></span>
        </p>

        <p>
            <strong>QR Number:</strong>
            <span id="qrNumber"></span>
        </p>

        <img
            id="registrationQR"
            alt="Your unique EESA registration QR code"
            style="width:220px;max-width:100%;display:block;margin:20px auto;"
        >

        <a
            id="downloadQR"
            download="EESA-Registration-QR.png"
            style="display:block;text-align:center;margin:20px;"
        >
            Download Your QR Code
        </a>

        <p>Save this QR code and present it to event management when requested.</p>
    `;

    document.getElementById("registrationId").textContent =
        result.registrationId;

    document.getElementById("qrNumber").textContent =
        result.qrNumber;

    document.getElementById("registrationQR").src = result.qrImage;

    document.getElementById("downloadQR").href = result.qrImage;

    section.scrollIntoView({ behavior: "smooth" });
}