// Import required modules
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');

// Set up Express server for keep-alive
function keepAlive() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.get('/', (req, res) => {
    res.send('Bot is alive!');
  });

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

// Discord bot configuration
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// Guild-specific items data storage
const GUILD_ITEMS_DATA = {};
const GUILD_ITEM_NAMES_LOWER = {};

/**
 * Parse the items.txt content and return a dictionary of item IDs to names
 * @param {string} content - Content of the items file
 * @returns {Object} - Dictionary of item IDs to names
 */
function parseItemsContent(content) {
  const itemsData = {};

  let lineCount = 0;
  let successCount = 0;
  let errorCount = 0;

  try {
    const lines = content.split('\n');

    for (const line of lines) {
      lineCount++;
      const trimmedLine = line.trim();

      if (!trimmedLine.startsWith('add_item')) {
        continue;
      }

      // Improved splitting that handles empty fields
      const parts = trimmedLine.split('\\').filter(p => p !== '');

      // Skip if we don't have enough parts
      if (parts.length < 6) {
        errorCount++;
        console.log(`[WARN] Line ${lineCount}: Insufficient parts (${parts.length}) - ${trimmedLine.substring(0, 60)}...`);
        continue;
      }

      try {
        const itemId = parseInt(parts[1]);
        const itemName = parts[6].trim();

        // Skip empty names
        if (!itemName) {
          errorCount++;
          console.log(`[WARN] Line ${lineCount}: Empty item name - ID ${itemId}`);
          continue;
        }

        // Store the item
        itemsData[itemId] = itemName;
        successCount++;

      } catch (e) {
        errorCount++;
        console.log(`[ERROR] Line ${lineCount}: Failed to parse - ${e.message} - ${trimmedLine.substring(0, 60)}...`);
        continue;
      }
    }

    console.log(`\n[SUMMARY] Parsing complete:`);
    console.log(`- Total lines processed: ${lineCount}`);
    console.log(`- Items successfully parsed: ${successCount}`);
    console.log(`- Lines with errors: ${errorCount}`);

    return itemsData;
  } catch (e) {
    console.log(`[ERROR] Error reading content: ${e.message}`);
    return {};
  }
}

/**
 * Validate if file content is a proper items.txt format
 * @param {string} content - Content of the file
 * @returns {Object} - Validation result
 */
function validateItemsFile(content) {
  // Check if file contains at least some add_item entries
  const lines = content.split('\n');
  let addItemCount = 0;

  for (const line of lines) {
    if (line.trim().startsWith('add_item')) {
      addItemCount++;
      if (addItemCount >= 5) {  // If we find at least 5 add_item entries, consider it valid
        return { valid: true };
      }
    }
  }

  if (addItemCount === 0) {
    return { 
      valid: false, 
      reason: "File tidak valid: Tidak ditemukan entri 'add_item' dalam file."
    };
  } else if (addItemCount < 5) {
    return { 
      valid: true, 
      warning: `Hanya ditemukan ${addItemCount} entri 'add_item'. Format mungkin tidak lengkap.`
    };
  }

  return { valid: true };
}

/**
 * Initialize items data for a guild
 * @param {string} guildId - Discord guild ID
 * @param {Object} itemsData - Dictionary of item IDs to names
 */
function initializeGuildItems(guildId, itemsData) {
  GUILD_ITEMS_DATA[guildId] = itemsData;
  GUILD_ITEM_NAMES_LOWER[guildId] = {};

  for (const [key, value] of Object.entries(itemsData)) {
    GUILD_ITEM_NAMES_LOWER[guildId][key] = value.toLowerCase();
  }
}

/**
 * Find items by query with type filter and pagination for a specific guild
 * @param {string} guildId - Discord guild ID
 * @param {string} query - Search query
 * @param {string} type - Filter by 'block', 'seed', or 'all'
 * @param {number} limit - Maximum number of results to return
 * @returns {Array} - Array of matching items with IDs
 */
function findItemsByQuery(guildId, query, type = 'all', limit = 500) {
  if (!GUILD_ITEMS_DATA[guildId]) {
    return [];
  }

  query = query.toLowerCase().trim();
  if (!query) {
    return [];
  }

  let matches = [];
  for (const itemId in GUILD_ITEM_NAMES_LOWER[guildId]) {
    const nameLower = GUILD_ITEM_NAMES_LOWER[guildId][itemId];
    const name = GUILD_ITEMS_DATA[guildId][itemId];

    if (nameLower.includes(query)) {
      // Apply type filter if specified
      if (type === 'block' && nameLower.includes('seed')) {
        continue;
      } else if (type === 'seed' && !nameLower.includes('seed')) {
        continue;
      }

      matches.push([parseInt(itemId), name]);
    }
  }

  // Sort by ID and apply limit
  matches.sort((a, b) => a[0] - b[0]);
  return matches.slice(0, limit);
}

/**
 * Create paginated embed for search results
 * @param {Array} matches - Array of matching items
 * @param {number} page - Current page number
 * @param {number} itemsPerPage - Items per page
 * @param {string} query - Search query
 * @param {string} type - Filter type
 * @returns {Object} - Page info and embed
 */
function createPaginatedEmbed(matches, page, itemsPerPage, query, type) {
  const totalItems = matches.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // Ensure page is within bounds
  page = Math.max(1, Math.min(page, totalPages));

  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const pageItems = matches.slice(startIndex, endIndex);

  // Create embed
  const embed = new EmbedBuilder()
    .setTitle(`Search results for '${query}'${type !== 'all' ? ` (Type: ${type})` : ''}`)
    .setDescription(`Found ${totalItems} matches. Showing page ${page}/${totalPages}`)
    .setColor(0x3498DB);

  // Add fields for items
    if (pageItems.length > 0) {
      let fieldContent = '';

      for (const [itemId, itemName] of pageItems) {
        fieldContent += `• \`${itemId}\` - ${itemName}\n`;
      }

      // Split content into multiple fields if it exceeds Discord's limit
      if (fieldContent.length > 1024) {
        const chunks = [];
        let currentChunk = '';
        const lines = fieldContent.split('\n');
        
        for (const line of lines) {
          if ((currentChunk + line + '\n').length > 1024) {
            chunks.push(currentChunk);
            currentChunk = line + '\n';
          } else {
            currentChunk += line + '\n';
          }
        }
        if (currentChunk) chunks.push(currentChunk);

        // Add each chunk as a separate field
        chunks.forEach((chunk, index) => {
          embed.addFields([{
            name: index === 0 ? `Items (${startIndex + 1}-${endIndex})` : `Continued...`,
            value: chunk
          }]);
        });
      } else {
        embed.addFields([{ 
          name: `Items (${startIndex + 1}-${endIndex})`, 
          value: fieldContent || 'No items to display' 
        }]);
      }
    } else {
      embed.addFields([{ 
        name: 'No items found', 
        value: 'Try a different search query' 
      }]);
    }

  return {
    currentPage: page,
    totalPages: totalPages,
    embed: embed
  };
}

// Register slash commands
const commands = [
  {
    name: 'search',
    description: 'Mencari item berdasarkan nama dengan filter tipe opsional',
    options: [
      {
        name: 'query',
        description: 'Kata kunci pencarian',
        type: 3, // STRING
        required: true
      },
      {
        name: 'type',
        description: 'Filter berdasarkan tipe item',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'All', value: 'all' },
          { name: 'Block', value: 'block' },
          { name: 'Seed', value: 'seed' }
        ]
      },
      {
        name: 'page',
        description: 'Nomor halaman',
        type: 4, // INTEGER
        required: false
      }
    ]
  },
  {
    name: 'item',
    description: 'Mendapatkan informasi tentang item berdasarkan ID',
    options: [
      {
        name: 'item_id',
        description: 'ID Item',
        type: 4, // INTEGER
        required: true
      }
    ]
  },
  {
    name: 'additems',
    description: 'Menambahkan atau memperbarui database items.txt untuk server ini',
    options: [
      {
        name: 'file',
        description: 'File items.txt untuk diupload',
        type: 11, // ATTACHMENT
        required: true
      }
    ]
  },
  {
    name: 'delitems',
    description: 'Menghapus database items.txt untuk server ini'
  },
  {
    name: 'itemsinfo',
    description: 'Menampilkan informasi tentang database items.txt di server ini'
  }
];

// On ready event handler
client.on('ready', async () => {
  console.log(`\n[STARTUP] Logged in as ${client.user.tag} (ID: ${client.user.id})`);
  console.log('------');

  // Register slash commands
  try {
    const rest = new REST({ version: '9' }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log("\n[COMMANDS] Slash commands registered successfully");
  } catch (e) {
    console.log(`[ERROR] Failed to register commands: ${e.message}`);
  }

  console.log('------\nBot is ready!');
});

// Slash command interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  switch (commandName) {
    case 'search':
      await handleSearchCommand(interaction);
      break;

    case 'item':
      await handleItemCommand(interaction);
      break;

    case 'additems':
      await handleAddItemsCommand(interaction);
      break;

    case 'delitems':
      await handleDelItemsCommand(interaction);
      break;

    case 'itemsinfo':
      await handleItemsInfoCommand(interaction);
      break;
  }
});

/**
 * Handle the search command
 * @param {Object} interaction - Discord interaction
 */
async function handleSearchCommand(interaction) {
  const guildId = interaction.guildId;

  if (!GUILD_ITEMS_DATA[guildId] || Object.keys(GUILD_ITEMS_DATA[guildId]).length === 0) {
    await interaction.reply({
      content: "⚠️ Database items.txt belum didaftarkan di server ini. Silakan gunakan `/additems` untuk mengunggah file items.txt terlebih dahulu.",
      flags: 64
    });
    return;
  }

  const query = interaction.options.getString('query')?.trim();
  const type = interaction.options.getString('type') || 'all';
  let page = interaction.options.getInteger('page') || 1;

  if (!query) {
    await interaction.reply({
      content: "Mohon berikan kata kunci pencarian.",
      flags: 64
    });
    return;
  }

  await interaction.deferReply();

  const matches = findItemsByQuery(guildId, query, type);

  if (matches.length === 0) {
    await interaction.followUp(`Tidak ditemukan item yang cocok dengan: '${query}'${type !== 'all' ? ` (Type: ${type})` : ''}`);
    return;
  }

  // Check if we have too many results
  if (matches.length >= 500) {
    await interaction.followUp({
      content: `⚠️ Ditemukan lebih dari 500 kecocokan untuk '${query}'. Mohon masukkan kata kunci yang lebih spesifik untuk mempersempit hasil pencarian.`,
      flags: 64
    });
    return;
  }

  const ITEMS_PER_PAGE = 50;
  const { embed, currentPage, totalPages } = createPaginatedEmbed(
    matches, page, ITEMS_PER_PAGE, query, type
  );

  // Add pagination buttons if there are multiple pages
  const row = {
    type: 1, // ACTION_ROW
    components: []
  };

  if (totalPages > 1) {
    // First page button
    row.components.push({
      type: 2, // BUTTON
      style: 2, // SECONDARY
      custom_id: `search_first_${query}_${type}`,
      label: '<<',
      disabled: currentPage === 1
    });

    // Previous page button
    row.components.push({
      type: 2, // BUTTON
      style: 2, // SECONDARY
      custom_id: `search_prev_${query}_${type}`,
      label: '<',
      disabled: currentPage === 1
    });

    // Page indicator (not a button)
    row.components.push({
      type: 2, // BUTTON
      style: 2, // SECONDARY
      custom_id: `search_indicator_${currentPage}_${totalPages}`,
      label: `${currentPage}/${totalPages}`,
      disabled: true
    });

    // Next page button
    row.components.push({
      type: 2, // BUTTON
      style: 2, // SECONDARY
      custom_id: `search_next_${query}_${type}`,
      label: '>',
      disabled: currentPage === totalPages
    });

    // Last page button
    row.components.push({
      type: 2, // BUTTON
      style: 2, // SECONDARY
      custom_id: `search_last_${query}_${type}`,
      label: '>>',
      disabled: currentPage === totalPages
    });
  }

  // Send the reply
  if (totalPages > 1) {
    await interaction.followUp({
      embeds: [embed],
      components: [row]
    });
  } else {
    await interaction.followUp({
      embeds: [embed]
    });
  }
}

/**
 * Handle the item command
 * @param {Object} interaction - Discord interaction
 */
async function handleItemCommand(interaction) {
  const guildId = interaction.guildId;

  if (!GUILD_ITEMS_DATA[guildId] || Object.keys(GUILD_ITEMS_DATA[guildId]).length === 0) {
    await interaction.reply({
      content: "⚠️ Database items.txt belum didaftarkan di server ini. Silakan gunakan `/additems` untuk mengunggah file items.txt terlebih dahulu.",
      flags: 64
    });
    return;
  }

  const itemId = interaction.options.getInteger('item_id');

  if (GUILD_ITEMS_DATA[guildId][itemId]) {
    const embed = new EmbedBuilder()
      .setTitle(`Informasi Item: ${itemId}`)
      .setDescription(GUILD_ITEMS_DATA[guildId][itemId])
      .setColor(0x3498DB)
      .addFields(
        { name: "Item ID", value: itemId.toString(), inline: true },
        { name: "Nama Item", value: GUILD_ITEMS_DATA[guildId][itemId], inline: true }
      );

    // Determine if it's a block or seed
    const type = GUILD_ITEMS_DATA[guildId][itemId].toLowerCase().includes('seed') ? 'Seed' : 'Block';
    embed.addFields({ name: "Tipe", value: type, inline: true });

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: `Item dengan ID ${itemId} tidak ditemukan dalam database.`,
      flags: 64
    });
  }
}

/**
 * Handle the additems command
 * @param {Object} interaction - Discord interaction
 */
async function handleAddItemsCommand(interaction) {
  await interaction.deferReply();

  const guildId = interaction.guildId;
  const attachment = interaction.options.getAttachment('file');

  // Check if it's actually a text file named items.txt
  if (!attachment.name.toLowerCase() === 'items.txt') {
    await interaction.followUp({
      content: "⚠️ File harus bernama 'items.txt'! Mohon rename file Anda terlebih dahulu.",
      flags: 64
    });
    return;
  }

  // Check if file size is reasonable (max 10MB)
  if (attachment.size > 10 * 1024 * 1024) {
    await interaction.followUp({
      content: "⚠️ Ukuran file terlalu besar! Maksimal 10MB.",
      flags: 64
    });
    return;
  }

  try {
    // Download the file content
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }
    const content = await response.text();

    // Validate the file first
    const validation = validateItemsFile(content);
    if (!validation.valid) {
      await interaction.followUp({
        content: `❌ ${validation.reason}`,
        flags: 64
      });
      return;
    }

    // Parse the items
    const itemsData = parseItemsContent(content);

    if (Object.keys(itemsData).length === 0) {
      await interaction.followUp({
        content: "⚠️ Tidak ada item yang berhasil diparse dari file. Pastikan format file valid.",
        flags: 64
      });
      return;
    }

    // Check if guild already has items
    if (GUILD_ITEMS_DATA[guildId] && Object.keys(GUILD_ITEMS_DATA[guildId]).length > 0) {
      // Update existing items
      const oldCount = Object.keys(GUILD_ITEMS_DATA[guildId]).length;
      initializeGuildItems(guildId, itemsData);
      const newCount = Object.keys(itemsData).length;

      let message = `✅ Database items.txt berhasil diperbarui dengan ${newCount} item! Database lama (${oldCount} item) telah diganti.`;

      if (validation.warning) {
        message += `\n⚠️ Catatan: ${validation.warning}`;
      }

      await interaction.followUp({
        content: message,
        ephemeral: false
      });
    } else {
      // Add new items
      initializeGuildItems(guildId, itemsData);

      let message = `✅ Database items.txt berhasil ditambahkan dengan ${Object.keys(itemsData).length} item!`;

      if (validation.warning) {
        message += `\n⚠️ Catatan: ${validation.warning}`;
      }

      await interaction.followUp({
        content: message,
        ephemeral: false
      });
    }
  } catch (error) {
    console.error(`[ERROR] Failed to process items.txt: ${error.message}`);
    await interaction.followUp({
      content: `❌ Gagal memproses file: ${error.message}`,
      flags: 64
    });
  }
}

/**
 * Handle the delitems command
 * @param {Object} interaction - Discord interaction
 */
async function handleDelItemsCommand(interaction) {
  const guildId = interaction.guildId;

  // Check if the user has admin permissions
  if (!interaction.memberPermissions.has('ADMINISTRATOR')) {
    await interaction.reply({
      content: "❌ Anda memerlukan izin Administrator untuk menjalankan perintah ini.",
      flags: 64
    });
    return;
  }

  if (!GUILD_ITEMS_DATA[guildId] || Object.keys(GUILD_ITEMS_DATA[guildId]).length === 0) {
    await interaction.reply({
      content: "⚠️ Tidak ada database items.txt yang terdaftar di server ini.",
      flags: 64
    });
    return;
  }

  const itemCount = Object.keys(GUILD_ITEMS_DATA[guildId]).length;

  // Delete the guild's items data
  delete GUILD_ITEMS_DATA[guildId];
  delete GUILD_ITEM_NAMES_LOWER[guildId];

  await interaction.reply({
    content: `✅ Database items.txt berhasil dihapus dari server ini. ${itemCount} item telah dihapus.`,
    ephemeral: false
  });
}

/**
 * Handle the itemsinfo command
 * @param {Object} interaction - Discord interaction
 */
async function handleItemsInfoCommand(interaction) {
  const guildId = interaction.guildId;

  if (!GUILD_ITEMS_DATA[guildId] || Object.keys(GUILD_ITEMS_DATA[guildId]).length === 0) {
    await interaction.reply({
      content: "⚠️ Tidak ada database items.txt yang terdaftar di server ini. Gunakan `/additems` untuk menambahkan database items.txt.",
      flags: 64
    });
    return;
  }

  const itemsCount = Object.keys(GUILD_ITEMS_DATA[guildId]).length;
  const seedCount = Object.values(GUILD_ITEMS_DATA[guildId]).filter(name => 
    name.toLowerCase().includes('seed')).length;
  const blockCount = itemsCount - seedCount;

  const embed = new EmbedBuilder()
    .setTitle('Informasi Database Items')
    .setDescription(`Database items.txt untuk server ini berisi ${itemsCount} item.`)
    .setColor(0x3498DB)
    .addFields(
      { name: "Total Item", value: itemsCount.toString(), inline: true },
      { name: "Blocks", value: blockCount.toString(), inline: true },
      { name: "Seeds", value: seedCount.toString(), inline: true },
      { name: "Contoh Items", value: sampleItems(guildId, 5) }
    );

  await interaction.reply({ embeds: [embed] });
}

/**
 * Get a sample of items from the guild's database
 * @param {string} guildId - Discord guild ID
 * @param {number} count - Number of sample items to get
 * @returns {string} - String with sample items
 */
function sampleItems(guildId, count) {
  if (!GUILD_ITEMS_DATA[guildId]) {
    return "No items available";
  }

  const items = Object.entries(GUILD_ITEMS_DATA[guildId])
    .slice(0, count)
    .map(([id, name]) => `• \`${id}\`: ${name}`)
    .join('\n');

  return items || "No items available";
}

// Handle button interactions for pagination
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const customId = interaction.customId;

  // Check if this is a search pagination button
  if (customId.startsWith('search_')) {
    const parts = customId.split('_');
    const action = parts[1]; // first, prev, next, last
    const query = parts[2];
    const type = parts[3];

    // Ignore the indicator button
    if (action === 'indicator') {
      await interaction.deferUpdate();
      return;
    }

    // Get the current page from the indicator button
    let currentPage = 1;
    let totalPages = 1;

    for (const component of interaction.message.components[0].components) {
      if (component.customId && component.customId.startsWith('search_indicator_')) {
        const pageParts = component.label.split('/');
        currentPage = parseInt(pageParts[0]);
        totalPages = parseInt(pageParts[1]);
        break;
      }
    }

    let newPage = currentPage;

    // Determine the new page based on the button clicked
    switch (action) {
      case 'first':
        newPage = 1;
        break;
      case 'prev':
        newPage = Math.max(1, currentPage - 1);
        break;
      case 'next':
        newPage = Math.min(totalPages, currentPage + 1);
        break;
      case 'last':
        newPage = totalPages;
        break;
    }

    // No change in page, do nothing
    if (newPage === currentPage) {
      await interaction.deferUpdate();
      return;
    }

    await interaction.deferUpdate();

    const guildId = interaction.guildId;

    // Get the matches again
    const matches = findItemsByQuery(guildId, query, type);
    const ITEMS_PER_PAGE = 50;

    // Create a new embed for the new page
    const { embed, currentPage: updatedCurrentPage } = createPaginatedEmbed(
      matches, newPage, ITEMS_PER_PAGE, query, type
    );

    // Update the pagination buttons
    const row = {
      type: 1, // ACTION_ROW
      components: [
        {
          type: 2, // BUTTON
          style: 2, // SECONDARY
          custom_id: `search_first_${query}_${type}`,
          label: '<<',
          disabled: updatedCurrentPage === 1
        },
        {
          type: 2, // BUTTON
          style: 2, // SECONDARY
          custom_id: `search_prev_${query}_${type}`,
          label: '<',
          disabled: updatedCurrentPage === 1
        },
        {
          type: 2, // BUTTON
          style: 2, // SECONDARY
          custom_id: `search_indicator_${updatedCurrentPage}_${totalPages}`,
          label: `${updatedCurrentPage}/${totalPages}`,
          disabled: true
        },
        {
          type: 2, // BUTTON
          style: 2, // SECONDARY
          custom_id: `search_next_${query}_${type}`,
          label: '>',
          disabled: updatedCurrentPage === totalPages
        },
        {
          type: 2, // BUTTON
          style: 2, // SECONDARY
          custom_id: `search_last_${query}_${type}`,
          label: '>>',
          disabled: updatedCurrentPage === totalPages
        }
      ]
    };

    // Update the message
    await interaction.message.edit({
      embeds: [embed],
      components: [row]
    });
  }
});

// Start the bot
const TOKEN = process.env.TOKEN; // Use environment variable for security

if (require.main === module) {
  console.log("Starting bot...");
  try {
    keepAlive();
    client.login(TOKEN);
  } catch (e) {
    console.log(`\n[ERROR] Bot crashed: ${e.message}`);
  }
}