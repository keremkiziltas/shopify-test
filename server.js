require("dotenv").config({ path: "./.env" });

const express = require("express");
const app = express();
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

  const data = await response.json();
  return data;
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
              note
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
              note
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
              note
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

    if (existingCustomer) {
      let existingNote = {};

      try {
        existingNote = existingCustomer.note
          ? JSON.parse(existingCustomer.note)
          : {};
      } catch {
        existingNote = {};
      }

      const alreadyCompleted = existingNote.test_completed === true;
      const hasSelectedCoachBefore = !!existingNote.selectedCoach;
      const wantsToSaveSelectedCoach = !!selectedCoach;

      if (alreadyCompleted && !(wantsToSaveSelectedCoach && !hasSelectedCoachBefore)) {
        return res.status(400).json({
          success: false,
          message: "Bu testi zaten çözdünüz."
        });
      }

      const updateMutation = `
        mutation updateCustomer($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer {
              id
              email
              note
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const updatedNote = {
        test_completed: true,
        preferences: alreadyCompleted
          ? (existingNote.preferences || [])
          : (preferences || []),
        answers: alreadyCompleted
          ? (existingNote.answers || {})
          : (answers || {}),
        top3Coaches: alreadyCompleted
          ? (existingNote.top3Coaches || [])
          : (top3Coaches || []),
        selectedCoach: wantsToSaveSelectedCoach
          ? selectedCoach
          : (existingNote.selectedCoach || null)
      };

      const updateResult = await shopifyRequest(updateMutation, {
        input: {
          id: existingCustomer.id,
          note: JSON.stringify(updatedNote)
        }
      });

      const userErrors = updateResult?.data?.customerUpdate?.userErrors || [];

      if (userErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Müşteri güncellenemedi.",
          userErrors
        });
      }

      return res.json({
        success: true,
        message: alreadyCompleted
          ? "Seçilen koç kaydedildi."
          : "Test sonucu mevcut müşteriye kaydedildi.",
        customerId: existingCustomer.id
      });
    }

    const createMutation = `
      mutation createCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const noteData = {
      test_completed: true,
      preferences: preferences || [],
      answers: answers || {},
      top3Coaches: top3Coaches || [],
      selectedCoach: selectedCoach || null
    };

    const createResult = await shopifyRequest(createMutation, {
      input: {
        email,
        firstName: firstName || "",
        lastName: lastName || "",
        note: JSON.stringify(noteData)
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

    return res.json({
      success: true,
      message: "Test sonucu yeni müşteriye kaydedildi.",
      customerId: createResult?.data?.customerCreate?.customer?.id || null
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