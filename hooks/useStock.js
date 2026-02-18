import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Location, Team } from '../types';

export const useStock = () => {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const allItems = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('stock_items')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if (error) throw error;

            if (data && data.length > 0) {
                allItems.push(...data);
                if (data.length < pageSize) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        setStock(allItems);
    } catch (error) {
        console.error("Error fetching stock:", error.message);
        setStock([]);
    } finally {
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const addStockItem = useCallback(async (item, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const newItem = {
      ...item,
      location: Location.LEADING_STORES,
      assigned_to: Team.UNASSIGNED,
      user_id: user.id,
    };

    const { data: insertedData, error } = await supabase.from('stock_items').insert([newItem]).select().single();
    if (error) throw error;

    // Log movement
    const movement = {
      item_id: insertedData.id,
      item_barcode: insertedData.barcode,
      item_name: insertedData.name,
      movement_type: 'IN',
      location_from: 'New Stock',
      location_to: insertedData.location,
      user_id: user.id,
      username: assignerName,
    };
    const { error: moveError } = await supabase.from('stock_movements').insert(movement);
    if (moveError) {
      console.error("Movement log failed for new item:", moveError.message);
    }

    await fetchStock();
  }, [fetchStock]);

  const bulkAddStockItems = useCallback(async (items, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const newItems = items.map(item => ({
      ...item,
      location: Location.LEADING_STORES,
      assigned_to: Team.UNASSIGNED,
      user_id: user.id
    }));
    
    const { data: insertedData, error } = await supabase.from('stock_items').insert(newItems).select();
    if (error) throw error;

    if (insertedData) {
        const movements = insertedData.map(d => ({
            item_id: d.id,
            item_barcode: d.barcode,
            item_name: d.name,
            movement_type: 'IN',
            location_from: 'New Stock',
            location_to: d.location,
            user_id: user.id,
            username: assignerName,
        }));
        const { error: moveError } = await supabase.from('stock_movements').insert(movements);
        if (moveError) {
            console.error("Bulk movement log failed:", moveError.message);
        }
    }

    await fetchStock();
  }, [fetchStock]);

  const updateStockItemAssignment = useCallback(async (itemId, location, assigned_to, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const { data: itemBeforeUpdate, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .eq('id', itemId)
        .single();
    
    if (fetchError || !itemBeforeUpdate) throw fetchError || new Error('Item not found for logging movement');

    const oldAssignedTo = itemBeforeUpdate.assigned_to;
    const oldLocation = itemBeforeUpdate.location;
    const isAssigning = assigned_to !== Team.UNASSIGNED;

    const { error } = await supabase
      .from('stock_items')
      .update({ 
        location, 
        assigned_to,
        assigned_at: isAssigning ? new Date().toISOString() : null,
        assigned_by: isAssigning ? assignerName : null
      })
      .eq('id', itemId);
      
    if (error) throw error;

    let movement = null;
    if (oldAssignedTo === Team.UNASSIGNED && assigned_to !== Team.UNASSIGNED) {
      // OUT movement
      movement = {
        item_id: itemBeforeUpdate.id,
        item_barcode: itemBeforeUpdate.barcode,
        item_name: itemBeforeUpdate.name,
        movement_type: 'OUT',
        location_from: oldLocation,
        location_to: assigned_to,
        user_id: user.id,
        username: assignerName
      };
    } else if (oldAssignedTo !== Team.UNASSIGNED && assigned_to === Team.UNASSIGNED) {
      // IN movement (return)
      movement = {
        item_id: itemBeforeUpdate.id,
        item_barcode: itemBeforeUpdate.barcode,
        item_name: itemBeforeUpdate.name,
        movement_type: 'IN',
        location_from: oldAssignedTo,
        location_to: location,
        user_id: user.id,
        username: assignerName
      };
    }

    if (movement) {
      const { error: moveError } = await supabase.from('stock_movements').insert(movement);
      if (moveError) {
        console.error("Assignment movement log failed:", moveError.message);
      }
    }

    await fetchStock();
  }, [fetchStock]);

  const deleteStockItem = useCallback(async (itemId, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: itemToDelete, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .eq('id', itemId)
        .single();

    if (fetchError || !itemToDelete) throw fetchError || new Error('Item not found for deletion log');

    const { error } = await supabase
      .from('stock_items')
      .delete()
      .eq('id', itemId);

    if (error) throw error;
    
    const movement = {
      item_id: itemToDelete.id,
      item_barcode: itemToDelete.barcode,
      item_name: itemToDelete.name,
      movement_type: 'OUT',
      location_from: itemToDelete.assigned_to === Team.UNASSIGNED ? itemToDelete.location : itemToDelete.assigned_to,
      location_to: 'Deleted',
      user_id: user.id,
      username: assignerName
    };
    const { error: moveError } = await supabase.from('stock_movements').insert(movement);
    if (moveError) {
      console.error("Deletion movement log failed:", moveError.message);
    }

    await fetchStock();
  }, [fetchStock]);

  const getStockItemsByBarcode = useCallback(async (barcode) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('stock_items')
      .select('*')
      .eq('barcode', barcode)
      .eq('user_id', user.id);

    if (error) throw error;

    return data || [];
  }, []);

  const getExistingBarcodes = useCallback(async (barcodes) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
        .from('stock_items')
        .select('barcode')
        .eq('user_id', user.id)
        .in('barcode', barcodes);

    if (error) throw error;
    return new Set(data.map(item => item.barcode));
  }, []);

  return { stock, loading, addStockItem, bulkAddStockItems, updateStockItemAssignment, deleteStockItem, getStockItemsByBarcode, getExistingBarcodes, refetchStock: fetchStock };
};