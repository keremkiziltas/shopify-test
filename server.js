require("dotenv").config({ path: "./.env" });

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: ["https://rivakocluk.com", "https://www.rivakocluk.com"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function shopifyRequest(query, variables = {}) {
  const response = await fetch(`https://${SHOP}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  return response.json();
}

app.get("/", (req, res) => {
  res.send("API çalışıyor");
});

app.get("/customers", async (req, res) => {
  try {
    const query = `
      query {
        customers(first: 10) {
          edges {
            node {
              id
              firstName
              lastName
              email
              phone
              testTamamlandi: metafield(namespace: "custom", key: "test_tamamlandi") {
                value
              }
              secilenKoc: metafield(namespace: "custom", key: "secilen_koc") {
                value
              }
              top3Koc: metafield(namespace: "custom", key: "top_3_koc") {
                value
              }
              testCevaplari: metafield(namespace: "custom", key: "test_cevaplari") {
                value
              }
            }
          }
        }
      }
    `;

    const result = await shopifyRequest(query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/customer-by-email", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email zorunlu"
      });
    }

    const query = `
      query getCustomers($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              firstName
              lastName
              email
              phone
              testTamamlandi: metafield(namespace: "custom", key: "test_tamamlandi") {
                value
              }
              secilenKoc: metafield(namespace: "custom", key: "secilen_koc") {
                value
              }
              top3Koc: metafield(namespace: "custom", key: "top_3_koc") {
                value
              }
              testCevaplari: metafield(namespace: "custom", key: "test_cevaplari") {
                value
              }
            }
          }
        }
      }
    `;

    const result = await shopifyRequest(query, {
      query: `email:${email}`
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/submit-test", async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      preferences,
      answers,
      top3Coaches,
      selectedCoach
    } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email zorunlu"
      });
    }

    const searchQuery = `
      query getCustomers($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
              testTamamlandi: metafield(namespace: "custom", key: "test_tamamlandi") {
                value
              }
              secilenKoc: metafield(namespace: "custom", key: "secilen_koc") {
                value
              }
              top3Koc: metafield(namespace: "custom", key: "top_3_koc") {
                value
              }
              testCevaplari: metafield(namespace: "custom", key: "test_cevaplari") {
                value
              }
            }
          }
        }
      }
    `;

    const searchResult = await shopifyRequest(searchQuery, {
      query: `email:${email}`
    });

    const existingCustomer =
      searchResult?.data?.customers?.edges?.[0]?.node || null;

    let customerId = existingCustomer?.id || null;

    if (!customerId) {
      const createMutation = `
        mutation createCustomer($input: CustomerInput!) {
          customerCreate(input: $input) {
            customer {
              id
              email
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const createResult = await shopifyRequest(createMutation, {
        input: {
          email,
          firstName: firstName || "",
          lastName: lastName || ""
        }
      });

      const createErrors = createResult?.data?.customerCreate?.userErrors || [];

      if (createErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Müşteri oluşturulamadı.",
          userErrors: createErrors
        });
      }

      customerId = createResult?.data?.customerCreate?.customer?.id || null;

      if (!customerId) {
        return res.status(500).json({
          success: false,
          message: "Müşteri ID alınamadı."
        });
      }
    }

    const isCompleted = existingCustomer?.testTamamlandi?.value === "true";
    const hasSelectedCoachBefore = !!existingCustomer?.secilenKoc?.value;
    const wantsToSaveSelectedCoach = !!selectedCoach;

    if (isCompleted && !(wantsToSaveSelectedCoach && !hasSelectedCoachBefore)) {
      return res.status(400).json({
        success: false,
        message: "Bu testi zaten çözdünüz."
      });
    }

    const metafields = [];

    if (!isCompleted) {
      metafields.push(
        {
          ownerId: customerId,
          namespace: "custom",
          key: "test_tamamlandi",
          type: "boolean",
          value: "true"
        },
        {
          ownerId: customerId,
          namespace: "custom",
          key: "top_3_koc",
          type: "json",
          value: JSON.stringify(top3Coaches || [])
        },
        {
          ownerId: customerId,
          namespace: "custom",
          key: "test_cevaplari",
          type: "json",
          value: JSON.stringify({
            preferences: preferences || [],
            answers: answers || {}
          })
        }
      );
    }

    if (wantsToSaveSelectedCoach) {
      metafields.push({
        ownerId: customerId,
        namespace: "custom",
        key: "secilen_koc",
        type: "single_line_text_field",
        value: selectedCoach
      });
    }

    if (metafields.length === 0) {
      return res.json({
        success: true,
        message: "Güncellenecek veri yok.",
        customerId
      });
    }

    const metafieldsSetMutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            key
            namespace
            value
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const metafieldsResult = await shopifyRequest(metafieldsSetMutation, {
      metafields
    });

    const metafieldErrors =
      metafieldsResult?.data?.metafieldsSet?.userErrors || [];

    if (metafieldErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Metafield kaydedilemedi.",
        userErrors: metafieldErrors
      });
    }

    return res.json({
      success: true,
      message: isCompleted
        ? "Seçilen koç kaydedildi."
        : "Test sonucu kaydedildi.",
      customerId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server çalışıyor: http://localhost:${PORT}`);
});