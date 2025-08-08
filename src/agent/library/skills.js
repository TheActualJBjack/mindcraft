import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import { createMovements } from "./world.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';


export function log(bot, message) {
    bot.output += message + '\n';
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

async function equipHighestAttack(bot) {
    let weapons = bot.inventory.items().filter(item => item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe')));
    if (weapons.length === 0)
        weapons = bot.inventory.items().filter(item => item.name.includes('pickaxe') || item.name.includes('shovel'));
    if (weapons.length === 0)
        return;
    weapons.sort((a, b) => a.attackDamage < b.attackDamage);
    let weapon = weapons[0];
    if (weapon)
        await bot.equip(weapon, 'hand');
}

export async function craftRecipe(bot, itemName, num=1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    let placedTable = false;

    if (mc.getItemCraftingRecipes(itemName).length == 0) {
        log(bot, `${itemName} is either not an item, or it does not have a crafting recipe!`);
        return false;
    }

    // get recipes that don't require a crafting table
    let recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, null); 
    let craftingTable = null;
    const craftingTableRange = 32;
    placeTable: if (!recipes || recipes.length === 0) {
        recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, true);
        if(!recipes || recipes.length === 0) break placeTable; //Don't bother going to the table if we don't have the required resources.

        // Look for crafting table
        craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
        if (craftingTable === null){

            // Try to place crafting table
            let hasTable = world.getInventoryCounts(bot)['crafting_table'] > 0;
            if (hasTable) {
                let pos = world.getNearestFreeSpace(bot, 1, 6);
                await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
                craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
                if (craftingTable) {
                    recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
                    placedTable = true;
                }
            }
            else {
                log(bot, `Crafting ${itemName} requires a crafting table.`)
                return false;
            }
        }
        else {
            recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
        }
    }
    if (!recipes || recipes.length === 0) {
        log(bot, `You do not have the resources to craft a ${itemName}. It requires: ${Object.entries(mc.getItemCraftingRecipes(itemName)[0][0]).map(([key, value]) => `${key}: ${value}`).join(', ')}.`);
        if (placedTable) {
            await collectBlock(bot, 'crafting_table', 1);
        }
        return false;
    }
    
    if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
        await goToNearestBlock(bot, 'crafting_table', 4, craftingTableRange);
    }

    const recipe = recipes[0];
    console.log('crafting...');
    //Check that the agent has sufficient items to use the recipe `num` times.
    const inventory = world.getInventoryCounts(bot); //Items in the agents inventory
    const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe); //Items required to use the recipe once.
    const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);
    
    await bot.craft(recipe, Math.min(craftLimit.num, num), craftingTable);
    if(craftLimit.num<num) log(bot, `Not enough ${craftLimit.limitingResource} to craft ${num}, crafted ${craftLimit.num}. You now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    else log(bot, `Successfully crafted ${itemName}, you now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    if (placedTable) {
        await collectBlock(bot, 'crafting_table', 1);
    }

    //Equip any armor the bot may have crafted.
    //There is probablly a more efficient method than checking the entire inventory but this is all mineflayer-armor-manager provides. :P
    bot.armorManager.equipAll(); 

    return true;
}

export async function enchantItem(bot, item_name, enchantment_name) {
    /**
     * Enchant an item with a given enchantment.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} item_name, the name of the item to enchant.
     * @param {string} enchantment_name, the name of the enchantment to apply.
     * @returns {Promise<boolean>} true if the item was enchanted, false otherwise.
     * @example
     * await skills.enchantItem(bot, "diamond_sword", "sharpness");
     **/
    const item = bot.inventory.items().find(item => item.name === item_name);
    if (!item) {
        log(bot, `No ${item_name} in inventory.`);
        return false;
    }

    let enchanting_table = await world.getNearestBlock(bot, 'enchanting_table', 128);
    if (!enchanting_table) {
        log(bot, "No enchanting table nearby, trying to craft one.");
        await craftRecipe(bot, 'enchanting_table');
        enchanting_table = await world.getNearestBlock(bot, 'enchanting_table', 128);
        if (!enchanting_table) {
            log(bot, "Failed to craft an enchanting table.");
            return false;
        }
    }

    await goToPosition(bot, enchanting_table.position.x, enchanting_table.position.y, enchanting_table.position.z);

    const enchantment_window = await bot.openEnchantmentTable(enchanting_table);
    if (enchantment_window) {
        log(bot, "Opened enchanting table.");
        const enchantments = enchantment_window.enchantments;
        if (enchantments) {
            log(bot, "Available enchantments:");
            for (const enchantment of enchantments) {
                log(bot, `${enchantment.name} (level ${enchantment.level})`);
            }
        } else {
            log(bot, "No enchantments available.");
        }
        await bot.closeWindow(enchantment_window);
    } else {
        log(bot, "Failed to open enchanting table.");
        return false;
    }

    return true;
}

import fs from 'fs';
import { parse } from 'nucleation';

export async function buildFromSchematic(bot, schematic_file) {
    /**
     * Build a structure from a schematic file.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} schematic_file, the path to the schematic file.
     * @returns {Promise<boolean>} true if the structure was built, false otherwise.
     * @example
     * await skills.buildFromSchematic(bot, "schematics/house.schematic");
     **/
    try {
        const data = fs.readFileSync(schematic_file);
        const schematic = await parse(data);
        const at = bot.entity.position.floored();
        for (const block of schematic.blocks) {
            const pos = at.plus(block.pos);
            await placeBlock(bot, block.name, pos.x, pos.y, pos.z);
        }
        log(bot, `Finished building from schematic ${schematic_file}.`);
        return true;
    } catch (err) {
        log(bot, `Error building from schematic: ${err.message}`);
        return false;
    }
}

export async function leadAnimal(bot, animal_name, x, y, z) {
    /**
     * Lead an animal to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} animal_name, the name of the animal to lead.
     * @param {number} x, the x coordinate to lead the animal to.
     * @param {number} y, the y coordinate to lead the animal to.
     * @param {number} z, the z coordinate to lead the animal to.
     * @returns {Promise<boolean>} true if the animal was lead, false otherwise.
     * @example
     * await skills.leadAnimal(bot, "cow", 100, 64, 100);
     **/
    const lead = bot.inventory.items().find(item => item.name === 'lead');
    if (!lead) {
        log(bot, "No lead in inventory.");
        return false;
    }

    const animal = bot.nearestEntity(entity => entity.name === animal_name);
    if (!animal) {
        log(bot, `Could not find a ${animal_name} nearby.`);
        return false;
    }

    await goToPosition(bot, animal.position.x, animal.position.y, animal.position.z);

    await bot.equip(lead, 'hand');
    await bot.useOn(animal);
    log(bot, `Attached lead to ${animal_name}.`);

    await goToPosition(bot, x, y, z);

    await bot.useOn(animal);
    log(bot, `Detached lead from ${animal_name}.`);

    return true;
}

export async function mineOres(bot, ore_name, count) {
    /**
     * Mine a specified number of a given ore.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} ore_name, the name of the ore to mine.
     * @param {number} count, the number of ores to mine.
     * @returns {Promise<boolean>} true if the ores were mined, false otherwise.
     * @example
     * await skills.mineOres(bot, "coal_ore", 10);
     **/
    log(bot, `Mining ${count} ${ore_name}.`);
    for (let i = 0; i < count; i++) {
        const ore = await world.getNearestBlock(bot, ore_name, 128);
        if (ore) {
            await collectBlock(bot, ore_name, 1);
        } else {
            log(bot, `Could not find any ${ore_name} nearby.`);
            return false;
        }
    }
    log(bot, `Finished mining ${count} ${ore_name}.`);
    return true;
}

export async function chopTrees(bot, count) {
    /**
     * Chop down a specified number of trees.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} count, the number of trees to chop down.
     * @returns {Promise<boolean>} true if the trees were chopped down, false otherwise.
     * @example
     * await skills.chopTrees(bot, 10);
     **/
    log(bot, `Chopping down ${count} trees.`);
    for (let i = 0; i < count; i++) {
        const log_block = await world.getNearestBlock(bot, 'oak_log', 128); // just oak for now
        if (log_block) {
            await collectBlock(bot, 'oak_log', 1);
        } else {
            log(bot, `Could not find any trees nearby.`);
            return false;
        }
    }
    log(bot, `Finished chopping down ${count} trees.`);
    return true;
}

export async function goToNether(bot) {
    /**
     * Build a nether portal and go to the nether.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bot went to the nether, false otherwise.
     * @example
     * await skills.goToNether(bot);
     **/
    const obsidian = bot.inventory.items().find(item => item.name === 'obsidian');
    if (!obsidian || obsidian.count < 14) {
        log(bot, "Not enough obsidian to build a nether portal.");
        return false;
    }
    const flint_and_steel = bot.inventory.items().find(item => item.name === 'flint_and_steel');
    if (!flint_and_steel) {
        log(bot, "No flint and steel to light the portal.");
        return false;
    }

    const suitable_place = await findSuitablePlaceToBuildPortal(bot);
    if (!suitable_place) {
        log(bot, "Could not find a suitable place to build the portal.");
        return false;
    }

    await goToPosition(bot, suitable_place.x, suitable_place.y, suitable_place.z);

    // build the frame
    await placeBlock(bot, 'obsidian', suitable_place.x + 1, suitable_place.y, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x + 2, suitable_place.y, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x, suitable_place.y + 1, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x + 3, suitable_place.y + 1, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x, suitable_place.y + 2, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x + 3, suitable_place.y + 2, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x, suitable_place.y + 3, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x + 3, suitable_place.y + 3, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x + 1, suitable_place.y + 4, suitable_place.z);
    await placeBlock(bot, 'obsidian', suitable_place.x + 2, suitable_place.y + 4, suitable_place.z);

    // light the portal
    await bot.equip(flint_and_steel, 'hand');
    const portal_block = bot.blockAt(suitable_place.offset(1, 1, 0));
    await bot.activateBlock(portal_block);

    // step into the portal
    await goToPosition(bot, suitable_place.x + 1.5, suitable_place.y + 1, suitable_place.z);

    log(bot, "Went to the nether.");
    return true;
}

async function findSuitablePlaceToBuildPortal(bot) {
    const pos = bot.entity.position.floored();
    for (let x = pos.x - 16; x < pos.x + 16; x++) {
        for (let y = pos.y - 16; y < pos.y + 16; y++) {
            for (let z = pos.z - 16; z < pos.z + 16; z++) {
                const p = new Vec3(x, y, z);
                if (isSuitableForPortal(bot, p)) {
                    return p;
                }
            }
        }
    }
    return null;
}

function isSuitableForPortal(bot, pos) {
    for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 5; y++) {
            const p = pos.offset(x, y, 0);
            if (bot.blockAt(p).name !== 'air') {
                return false;
            }
        }
    }
    return true;
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num=1) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/

    if (!mc.isSmeltable(itemName)) {
        log(bot, `Cannot smelt ${itemName}. Hint: make sure you are smelting the 'raw' item.`);
        return false;
    }

    let placedFurnace = false;
    let furnaceBlock = undefined;
    const furnaceRange = 32;
    furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
    if (!furnaceBlock){
        // Try to place furnace
        let hasFurnace = world.getInventoryCounts(bot)['furnace'] > 0;
        if (hasFurnace) {
            let pos = world.getNearestFreeSpace(bot, 1, furnaceRange);
            await placeBlock(bot, 'furnace', pos.x, pos.y, pos.z);
            furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
            placedFurnace = true;
        }
    }
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby and you have no furnace.`)
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, furnaceRange);
    }
    bot.modes.pause('unstuck');
    await bot.lookAt(furnaceBlock.position);

    console.log('smelting...');
    const furnace = await bot.openFurnace(furnaceBlock);
    // check if the furnace is already smelting something
    let input_item = furnace.inputItem();
    if (input_item && input_item.type !== mc.getItemId(itemName) && input_item.count > 0) {
        // TODO: check if furnace is currently burning fuel. furnace.fuel is always null, I think there is a bug.
        // This only checks if the furnace has an input item, but it may not be smelting it and should be cleared.
        log(bot, `The furnace is currently smelting ${mc.getItemName(input_item.type)}.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }
    // check if the bot has enough items to smelt
    let inv_counts = world.getInventoryCounts(bot);
    if (!inv_counts[itemName] || inv_counts[itemName] < num) {
        log(bot, `You do not have enough ${itemName} to smelt.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }

    // fuel the furnace
    if (!furnace.fuelItem()) {
        let fuel = mc.getSmeltingFuel(bot);
        if (!fuel) {
            log(bot, `You have no fuel to smelt ${itemName}, you need coal, charcoal, or wood.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        log(bot, `Using ${fuel.name} as fuel.`);

        const put_fuel = Math.ceil(num / mc.getFuelSmeltOutput(fuel.name));

        if (fuel.count < put_fuel) {
            log(bot, `You don't have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${put_fuel}.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        await furnace.putFuel(fuel.type, null, put_fuel);
        log(bot, `Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`);
        console.log(`Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`)
    }
    // put the items in the furnace
    await furnace.putInput(mc.getItemId(itemName), null, num);
    // wait for the items to smelt
    let total = 0;
    let collected_last = true;
    let smelted_item = null;
    await new Promise(resolve => setTimeout(resolve, 200));
    while (total < num) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.log('checking...');
        let collected = false;
        if (furnace.outputItem()) {
            smelted_item = await furnace.takeOutput();
            if (smelted_item) {
                total += smelted_item.count;
                collected = true;
            }
        }
        if (!collected && !collected_last) {
            break; // if nothing was collected this time or last time
        }
        collected_last = collected;
        if (bot.interrupt_code) {
            break;
        }
    }
    await bot.closeWindow(furnace);

    if (placedFurnace) {
        await collectBlock(bot, 'furnace', 1);
    }
    if (total === 0) {
        log(bot, `Failed to smelt ${itemName}.`);
        return false;
    }
    if (total < num) {
        log(bot, `Only smelted ${total} ${mc.getItemName(smelted_item.type)}.`);
        return false;
    }
    log(bot, `Successfully smelted ${itemName}, got ${total} ${mc.getItemName(smelted_item.type)}.`);
    return true;
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    let furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
    if (!furnaceBlock) {
        log(bot, `No furnace nearby to clear.`);
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, 32);
    }

    console.log('clearing furnace...');
    const furnace = await bot.openFurnace(furnaceBlock);
    console.log('opened furnace...')
    // take the items out of the furnace
    let smelted_item, intput_item, fuel_item;
    if (furnace.outputItem())
        smelted_item = await furnace.takeOutput();
    if (furnace.inputItem())
        intput_item = await furnace.takeInput();
    if (furnace.fuelItem())
        fuel_item = await furnace.takeFuel();
    console.log(smelted_item, intput_item, fuel_item)
    let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
    let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
    let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
    log(bot, `Cleared furnace, received ${smelted_name}, ${input_name}, and ${fuel_name}.`);
    return true;

}


export async function attackNearest(bot, mobType, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    if (mobType === 'drowned' || mobType === 'cod' || mobType === 'salmon' || mobType === 'tropical_fish' || mobType === 'squid')
        bot.modes.pause('self_preservation'); // so it can go underwater. TODO: have an drowning mode so we don't turn off all self_preservation
    const mob = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, 'Could not find any '+mobType+' to attack.');
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    let pos = entity.position;
    await equipHighestAttack(bot)

    if (!kill) {
        if (bot.entity.position.distanceTo(pos) > 5) {
            console.log('moving to mob...')
            await goToPosition(bot, pos.x, pos.y, pos.z);
        }
        console.log('attacking mob...')
        await bot.attack(entity);
    }
    else {
        bot.pvp.attack(entity);
        while (world.getNearbyEntities(bot, 24).includes(entity)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (bot.interrupt_code) {
                bot.pvp.stop();
                return false;
            }
        }
        log(bot, `Successfully killed ${entity.name}.`);
        await pickupNearbyItems(bot);
        return true;
    }
}

export async function defendSelf(bot, range=9) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 8.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let attacked = false;
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), range);
    while (enemy) {
        await equipHighestAttack(bot);
        if (bot.entity.position.distanceTo(enemy.position) >= 4 && enemy.name !== 'creeper' && enemy.name !== 'phantom') {
            try {
                bot.pathfinder.setMovements(createMovements(bot));
                await bot.pathfinder.goto(new pf.goals.GoalFollow(enemy, 3.5), true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        if (bot.entity.position.distanceTo(enemy.position) <= 2) {
            try {
                bot.pathfinder.setMovements(createMovements(bot));
                let inverted_goal = new pf.goals.GoalInvert(new pf.goals.GoalFollow(enemy, 2));
                await bot.pathfinder.goto(inverted_goal, true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        bot.pvp.attack(enemy);
        attacked = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), range);
        if (bot.interrupt_code) {
            bot.pvp.stop();
            return false;
        }
    }
    bot.pvp.stop();
    if (attacked)
        log(bot, `Successfully defended self.`);
    else
        log(bot, `No enemies nearby to defend self from.`);
    return attacked;
}



export async function collectBlock(bot, blockType, num=1, exclude=null) {
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    let blocktypes = [blockType];
    if (blockType === 'coal' || blockType === 'diamond' || blockType === 'emerald' || blockType === 'iron' || blockType === 'gold' || blockType === 'lapis_lazuli' || blockType === 'redstone')
        blocktypes.push(blockType+'_ore');
    if (blockType.endsWith('ore'))
        blocktypes.push('deepslate_'+blockType);
    if (blockType === 'dirt')
        blocktypes.push('grass_block');

    let collected = 0;

    for (let i=0; i<num; i++) {
        let blocks = world.getNearestBlocks(bot, blocktypes, 64);
        if (exclude) {
            for (let position of exclude) {
                blocks = blocks.filter(
                    block => block.position.x !== position.x || block.position.y !== position.y || block.position.z !== position.z
                );
            }
        }
        const movements = createMovements(bot);
        movements.dontMineUnderFallingBlock = false;
        blocks = blocks.filter(
            block => movements.safeToBreak(block)
        );

        if (blocks.length === 0) {
            if (collected === 0)
                log(bot, `No ${blockType} nearby to collect.`);
            else
                log(bot, `No more ${blockType} nearby to collect.`);
            break;
        }
        const block = blocks[0];
        await bot.tool.equipForBlock(block);
        const itemId = bot.heldItem ? bot.heldItem.type : null
        if (!block.canHarvest(itemId)) {
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }
        try {
            if (mc.mustCollectManually(blockType)) {
                await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                await bot.dig(block);
                await pickupNearbyItems(bot);
            }
            else {
                await bot.collectBlock.collect(block);
            }
            collected++;
            await autoLight(bot);
        }
        catch (err) {
            if (err.name === 'NoChests') {
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                break;
            }
            else {
                log(bot, `Failed to collect ${blockType}: ${err}.`);
                continue;
            }
        }
        
        if (bot.interrupt_code)
            break;  
    }
    log(bot, `Collected ${collected} ${blockType}.`);
    return collected > 0;
}

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const distance = 8;
    const getNearestItem = bot => bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) < distance);
    let nearestItem = getNearestItem(bot);
    let pickedUp = 0;
    while (nearestItem) {
        bot.pathfinder.setMovements(createMovements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalFollow(nearestItem, 0.8), true);
        await new Promise(resolve => setTimeout(resolve, 200));
        let prev = nearestItem;
        nearestItem = getNearestItem(bot);
        if (prev === nearestItem) {
            break;
        }
        pickedUp++;
    }
    log(bot, `Picked up ${pickedUp} items.`);
    return true;
}


export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (x == null || y == null || z == null) throw new Error('Invalid position to break block at.');
    let block = bot.blockAt(Vec3(x, y, z));
    if (block.name !== 'air' && block.name !== 'water' && block.name !== 'lava') {
        if (bot.modes.isOn('cheat')) {
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            let movements = createMovements(bot);
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            bot.pathfinder.setMovements(movements);
            await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        }
        if (bot.game.gameMode !== 'creative') {
            await bot.tool.equipForBlock(block);
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        await bot.dig(block, true);
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    else {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}


export async function placeBlock(bot, blockType, x, y, z, placeOn='bottom', dontCheat=false) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    if (!mc.getBlockId(blockType) && blockType !== 'air') {
        log(bot, `Invalid block type: ${blockType}.`);
        return false;
    }

    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${target_dest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            let block = bot.inventory.items().find(item => item.name === blockType);
            if (!block) {
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // insert wall_ before torch
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }
        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }
        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door'))
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        if (blockType.includes('bed'))
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        log(bot, `Used /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    
    let item_name = blockType;
    if (item_name == "redstone_wire")
        item_name = "redstone";
    let block = bot.inventory.items().find(item => item.name === item_name);
    if (!block && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(item_name, 1)); // 36 is first hotbar slot
        block = bot.inventory.items().find(item => item.name === item_name);
    }
    if (!block) {
        log(bot, `Don't have any ${blockType} to place.`);
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (targetBlock.name === blockType) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern'];
    if (!empty_blocks.includes(targetBlock.name)) {
        log(bot, `${blockType} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (!empty_blocks.includes(block.name)) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone_wire', 'lever', 'button', 'rail', 'detector_rail', 'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket'];
    if (!dont_move_for.includes(blockType) && (pos.distanceTo(targetBlock.position) < 1 || pos_above.distanceTo(targetBlock.position) < 1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        bot.pathfinder.setMovements(createMovements(bot));
        await bot.pathfinder.goto(inverted_goal);
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        let movements = createMovements(bot);
        bot.pathfinder.setMovements(movements);
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    
    await bot.equip(block, 'hand');
    await bot.lookAt(buildOffBlock.position);

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        await bot.placeBlock(buildOffBlock, faceVec);
        log(bot, `Placed ${blockType} at ${target_dest}.`);
        await new Promise(resolve => setTimeout(resolve, 200));
        return true;
    } catch (err) {
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function equip(bot, itemName) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    let item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to equip.`);
        return false;
    }
    if (itemName.includes('leggings')) {
        await bot.equip(item, 'legs');
    }
    else if (itemName.includes('boots')) {
        await bot.equip(item, 'feet');
    }
    else if (itemName.includes('helmet')) {
        await bot.equip(item, 'head');
    }
    else if (itemName.includes('chestplate') || itemName.includes('elytra')) {
        await bot.equip(item, 'torso');
    }
    else if (itemName.includes('shield')) {
        await bot.equip(item, 'off-hand');
    }
    else {
        await bot.equip(item, 'hand');
    }
    log(bot, `Equipped ${itemName}.`);
    return true;
}

export async function discard(bot, itemName, num=-1) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    let discarded = 0;
    while (true) {
        let item = bot.inventory.items().find(item => item.name === itemName);
        if (!item) {
            break;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

export async function putInChest(bot, itemName, num=-1) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to put in the chest.
     * @param {number} num, the number of items to put in the chest. Defaults to -1, which puts all items.
     * @returns {Promise<boolean>} true if the item was put in the chest, false otherwise.
     * @example
     * await skills.putInChest(bot, "oak_log");
     **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    let item = bot.inventory.items().find(item => item.name === itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    let to_put = num === -1 ? item.count : Math.min(num, item.count);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    await chestContainer.deposit(item.type, null, to_put);
    await chestContainer.close();
    log(bot, `Successfully put ${to_put} ${itemName} in the chest.`);
    return true;
}

export async function takeFromChest(bot, itemName, num=-1) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to take from the chest.
     * @param {number} num, the number of items to take from the chest. Defaults to -1, which takes all items.
     * @returns {Promise<boolean>} true if the item was taken from the chest, false otherwise.
     * @example
     * await skills.takeFromChest(bot, "oak_log");
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    
    // Find all matching items in the chest
    let matchingItems = chestContainer.containerItems().filter(item => item.name === itemName);
    if (matchingItems.length === 0) {
        log(bot, `Could not find any ${itemName} in the chest.`);
        await chestContainer.close();
        return false;
    }
    
    let totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
    let remaining = num === -1 ? totalAvailable : Math.min(num, totalAvailable);
    let totalTaken = 0;
    
    // Take items from each slot until we've taken enough or run out
    for (const item of matchingItems) {
        if (remaining <= 0) break;
        
        let toTakeFromSlot = Math.min(remaining, item.count);
        await chestContainer.withdraw(item.type, null, toTakeFromSlot);
        
        totalTaken += toTakeFromSlot;
        remaining -= toTakeFromSlot;
    }
    
    await chestContainer.close();
    log(bot, `Successfully took ${totalTaken} ${itemName} from the chest.`);
    return totalTaken > 0;
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
     * @example
     * await skills.viewChest(bot);
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    let items = chestContainer.containerItems();
    if (items.length === 0) {
        log(bot, `The chest is empty.`);
    }
    else {
        log(bot, `The chest contains:`);
        for (let item of items) {
            log(bot, `${item.count} ${item.name}`);
        }
    }
    await chestContainer.close();
    return true;
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (itemName) {
        item = bot.inventory.items().find(item => item.name === itemName);
        name = itemName;
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    await bot.equip(item, 'hand');
    await bot.consume();
    log(bot, `Consumed ${item.name}.`);
    return true;
}


export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username, 3);
    // if we are 2 below the player
    log(bot, bot.entity.position.y, player.position.y);
    if (bot.entity.position.y < player.position.y - 1) {
        await goToPlayer(bot, username, 1);
    }
    // if we are too close, make some distance
    if (bot.entity.position.distanceTo(player.position) < 2) {
        let too_close = true;
        let start_moving_away = Date.now();
        await moveAwayFromEntity(bot, player, 2);
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            too_close = bot.entity.position.distanceTo(player.position) < 5;
            if (too_close) {
                await moveAwayFromEntity(bot, player, 5);
            }
            if (Date.now() - start_moving_away > 3000) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}, too close.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    if (await discard(bot, itemType, num)) {
        let given = false;
        bot.once('playerCollect', (collector, collected) => {
            console.log(collected.name);
            if (collector.username === username) {
                log(bot, `${username} received ${itemType}.`);
                given = true;
            }
        });
        let start = Date.now();
        while (!given && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (given) {
                return true;
            }
            if (Date.now() - start > 3000) {
                break;
            }
        }
    }
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}


export async function goToPosition(bot, x, y, z, min_distance=2) {
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    if (x == null || y == null || z == null) {
        log(bot, `Missing coordinates, given x:${x} y:${y} z:${z}`);
        return false;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        log(bot, `Teleported to ${x}, ${y}, ${z}.`);
        return true;
    }

    const movements = createMovements(bot);
    const hasScaffolding = movements.scafoldingBlocks.some(id => bot.inventory.hasItem(id));
    if (!hasScaffolding) {
        movements.allow1by1towers = false;
    }
    bot.pathfinder.setMovements(movements);

    const checkProgress = () => {
        if (bot.targetDigBlock) {
            const targetBlock = bot.targetDigBlock;
            const importantBlocks = ['chest', 'ender_chest', 'trapped_chest', 'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'anvil', 'chipped_anvil', 'damaged_anvil'];
            if (importantBlocks.includes(targetBlock.name)) {
                log(bot, `Pathfinding stopped: Attempting to break important block ${targetBlock.name}.`);
                bot.pathfinder.stop();
                bot.stopDigging();
                return;
            }
            const itemId = bot.heldItem ? bot.heldItem.type : null;
            if (!targetBlock.canHarvest(itemId)) {
                log(bot, `Pathfinding stopped: Cannot break ${targetBlock.name} with current tools.`);
                bot.pathfinder.stop();
                bot.stopDigging();
            }
        }
    };

    const progressInterval = setInterval(checkProgress, 1000);

    for (let i = 0; i < 3; i++) {
        try {
            await bot.pathfinder.goto(new pf.goals.GoalNear(x, y, z, min_distance));
            log(bot, `You have reached at ${x}, ${y}, ${z}.`);
            clearInterval(progressInterval);
            return true;
        } catch (err) {
            log(bot, `Pathfinding attempt ${i + 1} failed: ${err.message}.`);
            if (i < 2) {
                log(bot, "Trying to get unstuck by moving away...");
                await moveAway(bot, 3);
            }
        }
    }

    clearInterval(progressInterval);
    log(bot, `Pathfinding failed after 3 attempts.`);
    return false;
}

export async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
    /**
     * Navigate to the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to navigate to.
     * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
     * @param {number} range, the range to look for the block. Defaults to 64.
     * @returns {Promise<boolean>} true if the block was reached, false otherwise.
     * @example
     * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
     * **/
    const MAX_RANGE = 512;
    if (range > MAX_RANGE) {
        log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
        range = MAX_RANGE;
    }
    let block = world.getNearestBlock(bot, blockType, range);
    if (!block) {
        log(bot, `Could not find any ${blockType} in ${range} blocks.`);
        return false;
    }
    log(bot, `Found ${blockType} at ${block.position}. Navigating...`);
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, min_distance);
    return true;
    
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance} blocks away.`);
    await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
    return true;
}

export async function goToPlayer(bot, username, distance=3) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
     **/

    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }

    const move = createMovements(bot);
    bot.pathfinder.setMovements(move);
    await bot.pathfinder.goto(new pf.goals.GoalFollow(player, distance), true);

    log(bot, `You have reached ${username}.`);
}


export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    let player = bot.players[username].entity
    if (!player)
        return false;

    const move = createMovements(bot);
    bot.pathfinder.setMovements(move);
    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    log(bot, `You are now actively following player ${username}.`);

    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // in cheat mode, if the distance is too far, teleport to the player
        if (bot.modes.isOn('cheat') && bot.entity.position.distanceTo(player.position) > 100 && player.isOnGround) {
            await goToPlayer(bot, username);
        }
        if (bot.modes.isOn('unstuck')) {
            const is_nearby = bot.entity.position.distanceTo(player.position) <= distance + 1;
            if (is_nearby)
                bot.modes.pause('unstuck');
            else
                bot.modes.unpause('unstuck');
        }
    }
    return true;
}


export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position;
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(createMovements(bot));

    if (bot.modes.isOn('cheat')) {
        const move = createMovements(bot);
        const path = await bot.pathfinder.getPathTo(move, inverted_goal, 10000);
        let last_move = path.path[path.path.length-1];
        console.log(last_move);
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            return true;
        }
    }

    await bot.pathfinder.goto(inverted_goal);
    let new_pos = bot.entity.position;
    log(bot, `Moved away from nearest entity to ${new_pos}.`);
    return true;
}

export async function moveAwayFromEntity(bot, entity, distance=16) {
    /**
     * Move away from the given entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to move away from.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     **/
    let goal = new pf.goals.GoalFollow(entity, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(createMovements(bot));
    await bot.pathfinder.goto(inverted_goal);
    return true;
}

export async function avoidEnemies(bot, distance=16) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    bot.modes.pause('self_preservation'); // prevents damage-on-low-health from interrupting the bot
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
    while (enemy) {
        const follow = new pf.goals.GoalFollow(enemy, distance+1); // move a little further away
        const inverted_goal = new pf.goals.GoalInvert(follow);
        bot.pathfinder.setMovements(createMovements(bot));
        bot.pathfinder.setGoal(inverted_goal, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
        if (bot.interrupt_code) {
            break;
        }
        if (enemy && bot.entity.position.distanceTo(enemy.position) < 3) {
            await attackEntity(bot, enemy, false);
        }
    }
    bot.pathfinder.stop();
    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('unstuck');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    if (!door_pos) {
        for (let door_type of ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
                               'mangrove_door', 'cherry_door', 'bamboo_door', 'crimson_door', 'warped_door']) {
            door_pos = world.getNearestBlock(bot, door_type, 16).position;
            if (door_pos) break;
        }
    } else {
        door_pos = Vec3(door_pos.x, door_pos.y, door_pos.z);
    }
    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    bot.pathfinder.setGoal(new pf.goals.GoalNear(door_pos.x, door_pos.y, door_pos.z, 1));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (bot.pathfinder.isMoving()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    let door_block = bot.blockAt(door_pos);
    await bot.lookAt(door_pos);
    if (!door_block._properties.open)
        await bot.activateBlock(door_block);
    
    bot.setControlState("forward", true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    bot.setControlState("forward", false);
    await bot.activateBlock(door_block);

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => {
            return block.name.includes('bed');
        },
        maxDistance: 32,
        count: 1
    });
    if (beds.length === 0) {
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    await bot.sleep(bed);
    log(bot, `You are in bed.`);
    bot.modes.pause('unstuck');
    while (bot.isSleeping) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    let block = bot.blockAt(new Vec3(x, y, z));

    if (bot.modes.isOn('cheat')) {
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        placeBlock(bot, 'farmland', x, y, z);
        placeBlock(bot, seedType, x, y+1, z);
        return true;
    }

    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        log(bot, `Cannot till, there is ${above.name} above the block.`);
        return false;
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(createMovements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        if (!hoe) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.equip(hoe, 'hand');
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let seeds = bot.inventory.items().find(item => item.name === seedType);
        if (!seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }
        await bot.equip(seeds, 'hand');

        await bot.placeBlock(block, new Vec3(0, -1, 0));
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(createMovements(bot));
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    let start_block_pos = bot.blockAt(bot.entity.position).position;
    for (let i = 1; i <= distance; i++) {
        const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
        let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

        if (!targetBlock || !belowBlock) {
            log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
            return true;
        }

        // Check for lava, water
        if (targetBlock.name === 'lava' || targetBlock.name === 'water' || 
            belowBlock.name === 'lava' || belowBlock.name === 'water') {
            log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
            return false;
        }

        const MAX_FALL_BLOCKS = 2;
        let num_fall_blocks = 0;
        for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
            if (!belowBlock || (belowBlock.name !== 'air' && belowBlock.name !== 'cave_air')) {
                break;
            }
            num_fall_blocks++;
            belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
        }
        if (num_fall_blocks > MAX_FALL_BLOCKS) {
            log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
            return false;
        }

        if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') {
            log(bot, 'Skipping air block');
            console.log(targetBlock.position);
            continue;
        }

        let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
        if (!dug) {
            log(bot, 'Failed to dig block at position:' + targetBlock.position);
            return false;
        }
    }
    log(bot, `Dug down ${distance} blocks.`);
    return true;
}

export async function buildBridge(bot, direction, length) {
    /**
     * Build a bridge in the given direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} direction, the direction to build the bridge in. Can be 'forward', 'backward', 'left', 'right'.
     * @param {number} length, the length of the bridge.
     * @returns {Promise<boolean>} true if the bridge was built, false otherwise.
     * @example
     * await skills.buildBridge(bot, "forward", 10);
     **/
    const movements = createMovements(bot);
    const hasScaffolding = movements.scafoldingBlocks.some(id => bot.inventory.hasItem(id));
    if (!hasScaffolding) {
        log(bot, "Cannot build bridge: No scaffolding blocks in inventory.");
        return false;
    }

    const lookVec = bot.entity.lookVec.clone();
    lookVec.y = 0;
    lookVec.normalize();

    let dir;
    if (direction === 'forward') {
        dir = lookVec;
    } else if (direction === 'backward') {
        dir = lookVec.scaled(-1);
    } else if (direction === 'left') {
        dir = new Vec3(-lookVec.z, 0, lookVec.x);
    } else if (direction === 'right') {
        dir = new Vec3(lookVec.z, 0, -lookVec.x);
    } else {
        log(bot, `Invalid direction: ${direction}.`);
        return false;
    }

    log(bot, `Building a bridge of length ${length} in direction ${direction}.`);

    for (let i = 0; i < length; i++) {
        const target_pos = bot.entity.position.plus(dir);
        await goToPosition(bot, target_pos.x, target_pos.y, target_pos.z, 0);

        const block_below_pos = bot.entity.position.floored().offset(0, -1, 0);
        const block_below = bot.blockAt(block_below_pos);
        if (block_below.name === 'air') {
            const scaffolding_item = movements.scafoldingBlocks.find(id => bot.inventory.hasItem(id));
            if (scaffolding_item) {
                const item = mc.getItemName(scaffolding_item);
                await placeBlock(bot, item, block_below_pos.x, block_below_pos.y, block_below_pos.z);
            } else {
                log(bot, "Ran out of scaffolding blocks.");
                return false;
            }
        }
    }

    log(bot, "Finished building bridge.");
    return true;
}

export async function buildPillar(bot, height) {
    /**
     * Build a pillar of the given height.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} height, the height of the pillar.
     * @returns {Promise<boolean>} true if the pillar was built, false otherwise.
     * @example
     * await skills.buildPillar(bot, 10);
     **/
    const movements = createMovements(bot);
    const hasScaffolding = movements.scafoldingBlocks.some(id => bot.inventory.hasItem(id));
    if (!hasScaffolding) {
        log(bot, "Cannot build pillar: No scaffolding blocks in inventory.");
        return false;
    }

    log(bot, `Building a pillar of height ${height}.`);

    for (let i = 0; i < height; i++) {
        const scaffolding_item = movements.scafoldingBlocks.find(id => bot.inventory.hasItem(id));
        if (scaffolding_item) {
            bot.setControlState('jump', true);
            await new Promise(resolve => setTimeout(resolve, 200));
            const item = mc.getItemName(scaffolding_item);
            const current_pos = bot.entity.position.floored();
            await placeBlock(bot, item, current_pos.x, current_pos.y - 1, current_pos.z);
            bot.setControlState('jump', false);
            await new Promise(resolve => setTimeout(resolve, 200));
        } else {
            log(bot, "Ran out of scaffolding blocks.");
            return false;
        }
    }

    log(bot, "Finished building pillar.");
    return true;
}

export async function buildStairs(bot, direction, height) {
    /**
     * Build a staircase of the given height.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} direction, the direction to build the stairs in. Can be 'forward', 'backward', 'left', 'right'.
     * @param {number} height, the height of the staircase.
     * @returns {Promise<boolean>} true if the staircase was built, false otherwise.
     * @example
     * await skills.buildStairs(bot, "forward", 10);
     **/
    const movements = createMovements(bot);
    const hasScaffolding = movements.scafoldingBlocks.some(id => bot.inventory.hasItem(id));
    if (!hasScaffolding) {
        log(bot, "Cannot build stairs: No scaffolding blocks in inventory.");
        return false;
    }

    const lookVec = bot.entity.lookVec.clone();
    lookVec.y = 0;
    lookVec.normalize();

    let dir;
    if (direction === 'forward') {
        dir = lookVec;
    } else if (direction === 'backward') {
        dir = lookVec.scaled(-1);
    } else if (direction === 'left') {
        dir = new Vec3(-lookVec.z, 0, lookVec.x);
    } else if (direction === 'right') {
        dir = new Vec3(lookVec.z, 0, -lookVec.x);
    } else {
        log(bot, `Invalid direction: ${direction}.`);
        return false;
    }

    log(bot, `Building a staircase of height ${height} in direction ${direction}.`);

    for (let i = 0; i < height; i++) {
        const scaffolding_item = movements.scafoldingBlocks.find(id => bot.inventory.hasItem(id));
        if (scaffolding_item) {
            const item = mc.getItemName(scaffolding_item);
            const current_pos = bot.entity.position.floored();
            await placeBlock(bot, item, current_pos.x + dir.x, current_pos.y + i, current_pos.z + dir.z);
            await goToPosition(bot, current_pos.x + dir.x, current_pos.y + i + 1, current_pos.z + dir.z);
        } else {
            log(bot, "Ran out of scaffolding blocks.");
            return false;
        }
    }

    log(bot, "Finished building staircase.");
    return true;
}

export async function buildSpiralStaircase(bot, height) {
    /**
     * Build a spiral staircase of the given height.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} height, the height of the staircase.
     * @returns {Promise<boolean>} true if the staircase was built, false otherwise.
     * @example
     * await skills.buildSpiralStaircase(bot, 10);
     **/
    const movements = createMovements(bot);
    const hasScaffolding = movements.scafoldingBlocks.some(id => bot.inventory.hasItem(id));
    if (!hasScaffolding) {
        log(bot, "Cannot build spiral staircase: No scaffolding blocks in inventory.");
        return false;
    }

    log(bot, `Building a spiral staircase of height ${height}.`);

    let direction = 0; // 0: forward, 1: right, 2: backward, 3: left
    for (let i = 0; i < height; i++) {
        const scaffolding_item = movements.scafoldingBlocks.find(id => bot.inventory.hasItem(id));
        if (scaffolding_item) {
            const item = mc.getItemName(scaffolding_item);
            const current_pos = bot.entity.position.floored();
            let place_pos;
            if (direction === 0) {
                place_pos = current_pos.offset(1, i, 0);
            } else if (direction === 1) {
                place_pos = current_pos.offset(0, i, 1);
            } else if (direction === 2) {
                place_pos = current_pos.offset(-1, i, 0);
            } else {
                place_pos = current_pos.offset(0, i, -1);
            }
            await placeBlock(bot, item, place_pos.x, place_pos.y, place_pos.z);
            await goToPosition(bot, place_pos.x, place_pos.y + 1, place_pos.z);
            direction = (direction + 1) % 4;
        } else {
            log(bot, "Ran out of scaffolding blocks.");
            return false;
        }
    }

    log(bot, "Finished building spiral staircase.");
    return true;
}

export async function tradeWithVillager(bot) {
    /**
     * Find a nearby villager and view its trades.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if a villager was found, false otherwise.
     * @example
     * await skills.tradeWithVillager(bot);
     **/
    const villager = bot.nearestEntity(entity => entity.name === 'villager');
    if (!villager) {
        log(bot, "Could not find a villager nearby.");
        return false;
    }

    await goToPosition(bot, villager.position.x, villager.position.y, villager.position.z);

    const trade_window = await bot.openVillager(villager);
    if (trade_window) {
        log(bot, "Opened trade window with villager.");
        const trades = trade_window.trades;
        if (trades) {
            log(bot, "Available trades:");
            for (const trade of trades) {
                log(bot, `${trade.inputItem1.count} ${trade.inputItem1.name} + ${trade.inputItem2 ? trade.inputItem2.count : ''} ${trade.inputItem2 ? trade.inputItem2.name : ''} => ${trade.outputItem.count} ${trade.outputItem.name}`);
            }
        } else {
            log(bot, "No trades available.");
        }
        await bot.closeWindow(trade_window);
    } else {
        log(bot, "Failed to open trade window with villager.");
        return false;
    }

    return true;
}

export async function swim(bot, x, y, z) {
    /**
     * Swim to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to swim to.
     * @param {number} y, the y coordinate to swim to.
     * @param {number} z, the z coordinate to swim to.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * await skills.swim(bot, 100, 64, 100);
     **/
    const movements = createMovements(bot);
    movements.liquidCost = 0.1;
    bot.pathfinder.setMovements(movements);
    await goToPosition(bot, x, y, z);
    return true;
}

export async function setPathfindingProfile(bot, profile) {
    /**
     * Set the pathfinding profile.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} profile, the name of the profile to set. Can be 'safe', 'fast', or 'builder'.
     * @returns {Promise<boolean>} true if the profile was set, false otherwise.
     * @example
     * await skills.setPathfindingProfile(bot, "fast");
     **/
    if (bot.pathfinding.profiles[profile]) {
        bot.pathfinding.current_profile = profile;
        log(bot, `Pathfinding profile set to ${profile}.`);
        return true;
    } else {
        log(bot, `Invalid pathfinding profile: ${profile}.`);
        return false;
    }
}

export async function buildAndUseBoat(bot, x, y, z) {
    /**
     * Build a boat and use it to go to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to go to.
     * @param {number} y, the y coordinate to go to.
     * @param {number} z, the z coordinate to go to.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * await skills.buildAndUseBoat(bot, 100, 64, 100);
     **/
    let boat = bot.inventory.items().find(item => item.name.endsWith('_boat'));
    if (!boat) {
        log(bot, "No boat in inventory, trying to craft one.");
        // find any type of wood planks
        const wood_planks = bot.inventory.items().find(item => item.name.endsWith('_planks'));
        if (!wood_planks || wood_planks.count < 5) {
            log(bot, "Not enough wood planks to craft a boat.");
            return false;
        }
        const boat_name = wood_planks.name.replace('_planks', '_boat');
        await craftRecipe(bot, boat_name);
        boat = bot.inventory.items().find(item => item.name.endsWith('_boat'));
        if (!boat) {
            log(bot, "Failed to craft a boat.");
            return false;
        }
    }

    const suitable_place = await findSuitablePlaceToLaunchBoat(bot);
    if (!suitable_place) {
        log(bot, "Could not find a suitable place to launch the boat.");
        return false;
    }

    await goToPosition(bot, suitable_place.x, suitable_place.y, suitable_place.z);

    await bot.equip(boat, 'hand');
    const boat_entity = await bot.placeBoat(bot.blockAt(suitable_place));
    if (!boat_entity) {
        log(bot, "Failed to place the boat.");
        return false;
    }

    await bot.mount(boat_entity);
    log(bot, "Mounted the boat.");

    const target_pos = new Vec3(x, y, z);
    while (bot.entity.position.distanceTo(target_pos) > 2) {
        await bot.lookAt(target_pos);
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    bot.setControlState('forward', false);


    await bot.dismount();
    log(bot, "Dismounted the boat.");

    return true;
}

async function findSuitablePlaceToLaunchBoat(bot) {
    const water_blocks = bot.findBlocks({
        matching: mc.getBlockId('water'),
        maxDistance: 16,
        count: 100
    });

    for (const water_block of water_blocks) {
        const block_above = bot.blockAt(water_block.offset(0, 1, 0));
        if (block_above.name === 'air') {
            return water_block;
        }
    }

    return null;
}
